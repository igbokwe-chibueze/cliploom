import { stat, rm, rename } from 'node:fs/promises';
import { db } from './db';
import { config } from './config';
import { settingsSchema, mergeChunks, transcriptSchema, normalizeInheritedCaptionOverlaps, type TranscriptData } from './domain';
import { storage } from './storage';
import { probe, runProcess } from './media';
import { fixtureSelector, fixtureTranscriber, geminiSelector, groqTranscriber } from './providers';
import { renderer, type RenderSpec } from './render';

export async function processJob(jobId: string, signal: AbortSignal) {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: { project: { include: { assets: true, transcript: true } } } });
  const project = job.project;
  const assertActive = async () => { signal.throwIfAborted(); const p = await db.project.findUnique({ where: { id: project.id } }); if (!p || p.deletedAt) throw new Error('Project deleted.'); };
  const stage = async (name: string) => { await assertActive(); await db.job.update({ where: { id: job.id }, data: { stage: name } }); if (job.type !== 'render') await db.project.update({ where: { id: project.id }, data: { stage: name, status: 'running', error: null } }); };
  if (job.type === 'render') {
    const render = await db.render.findUniqueOrThrow({ where: { id: job.renderId! }, include: { clip: true } });
    if (render.revision !== render.clip.revision) { await db.render.update({ where: { id: render.id }, data: { status: 'outdated' } }); return; }
    await stage('render');
    await db.render.update({ where: { id: render.id }, data: { status: 'running', error: null } });
    const result = await renderer.render(render.spec as unknown as RenderSpec, project.id, render.id, signal);
    await assertActive();
    const current = await db.$transaction(async tx => {
      const clip = await tx.clip.findUniqueOrThrow({ where: { id: render.clipId }, include: { project: true } });
      const valid = clip.revision === render.revision && !clip.project.deletedAt;
      await tx.render.update({ where: { id: render.id }, data: valid ? { status: 'completed', key: result.key } : { status: 'outdated' } });
      return valid;
    });
    if (!current) await rm(storage.path(result.key), { force: true });
    return;
  }
  const source = project.assets.find(a => a.kind === 'source');
  if (!source) throw new Error('Source media is missing. Upload the file again.');
  if (project.mode === 'live' && !config.GEMINI_API_KEY) throw new Error('Set GEMINI_API_KEY in .env before processing. No transcription was requested.');
  if (project.mode === 'live' && !project.transcript && !config.GROQ_API_KEY) throw new Error('Set GROQ_API_KEY in .env before processing.');
  await stage('validate');
  const media = await probe(storage.path(source.key), signal);
  await assertActive();
  await db.project.update({ where: { id: project.id }, data: { durationMs: media.durationMs, width: media.width, height: media.height } });
  // Persist only app-owned probe metadata; rotation is already reflected in dimensions.
  await db.mediaAsset.update({ where: { id: source.id }, data: { metadata: media } });
  let transcript = project.transcript ? transcriptSchema.parse(project.transcript.original) : null;
  if (!transcript) {
    if (!project.assets.some(a => a.kind === 'preview')) {
      await stage('preview');
      const key = `${project.id}/preview.mp4`; const file = await storage.prepare(key);
      try {
        await runProcess(config.FFMPEG_PATH, ['-y', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe', '-i', storage.path(source.key), '-map', '0:v:0', '-map', '0:a:0', '-vf', "scale='min(640,iw)':-2,setsar=1", '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', '-fs', String(config.maxUploadBytes), file + '.partial.mp4'], { signal });
        await assertActive(); await probe(file + '.partial.mp4', signal); await rename(file + '.partial.mp4', file);
        await db.mediaAsset.upsert({ where: { projectId_kind: { projectId: project.id, kind: 'preview' } }, create: { projectId: project.id, kind: 'preview', key, mime: 'video/mp4', bytes: (await stat(file)).size }, update: {} });
      } finally { await rm(file + '.partial.mp4', { force: true }); }
    }
    const chunks: { offsetMs: number; data: TranscriptData }[] = []; const usage: unknown[] = [];
    const chunkMs = Math.min(config.AUDIO_CHUNK_SECONDS * 1000, Math.floor(config.PROVIDER_MAX_FILE_MB * 1024 * 1024 / 32_000) * 1000 - 1000);
    if (chunkMs < 10_000) throw new Error('PROVIDER_MAX_FILE_MB is too small for audio extraction.');
    for (let offset = 0, index = 0; offset < media.durationMs; offset += chunkMs - 1000, index++) {
      await assertActive();
      const cacheKey = `${project.id}/transcript/chunk-${index}.json`;
      const cached = await storage.json<{ data: TranscriptData; usage: unknown }>(cacheKey);
      if (cached) { chunks.push({ offsetMs: offset, data: transcriptSchema.parse(cached.data) }); usage.push(cached.usage); continue; }
      const duration = Math.min(chunkMs, media.durationMs - offset);
      const audioKey = `${project.id}/temp/audio-${index}.wav`; const audio = await storage.prepare(audioKey);
      try {
        await stage(`extract-audio ${index + 1}`);
        await runProcess(config.FFMPEG_PATH, ['-y', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe', '-ss', String(offset / 1000), '-i', storage.path(source.key), '-t', String(duration / 1000), '-vn', '-map', '0:a:0', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', audio], { signal });
        if ((await stat(audio)).size > config.PROVIDER_MAX_FILE_MB * 1024 * 1024) throw new Error('Extracted audio exceeds the configured provider file limit. Lower AUDIO_CHUNK_SECONDS.');
        await stage(`transcribe ${index + 1}`);
        const result = await (project.mode === 'fixture' ? fixtureTranscriber : groqTranscriber).transcribe(audio, duration, signal);
        await assertActive(); await storage.putJson(cacheKey, result);
        chunks.push({ offsetMs: offset, data: result.data }); usage.push(result.usage);
      } finally { await rm(audio, { force: true }); }
      if (offset + chunkMs >= media.durationMs) break;
    }
    transcript = mergeChunks(chunks, media.durationMs);
    if (!transcript.segments.length) throw new Error('No usable speech found in this source.');
    await assertActive();
    await db.transcript.upsert({ where: { projectId: project.id }, create: { projectId: project.id, original: transcript, edited: transcript, provider: project.mode === 'fixture' ? 'fixture' : 'groq', model: project.mode === 'fixture' ? 'synthetic-v1' : config.TRANSCRIPTION_MODEL, usage: JSON.parse(JSON.stringify(usage)) }, update: {} });
  }
  await stage('select-clips');
  const version = (await db.project.findUniqueOrThrow({ where: { id: project.id } })).selectionVersion;
  const cacheKey = `${project.id}/selection-${version}.json`;
  let selection = await storage.json<{ clips: { title: string; reason: string; startMs: number; endMs: number }[]; usage: unknown }>(cacheKey);
  if (!selection) { selection = await (project.mode === 'fixture' ? fixtureSelector : geminiSelector).select(transcript, media.durationMs, project.clipCount, signal); await assertActive(); await storage.putJson(cacheKey, { ...selection, provider: project.mode === 'fixture' ? 'fixture' : 'gemini', model: project.mode === 'fixture' ? 'synthetic-v1' : config.CLIP_SELECTION_MODEL, version }); }
  await assertActive();
  await db.$transaction(async tx => {
    const existing = await tx.clip.count({ where: { projectId: project.id } });
    if (!existing) for (const clip of selection.clips) await tx.clip.create({ data: { ...clip, projectId: project.id, settings: JSON.parse(JSON.stringify(settingsSchema.parse({ captions: normalizeInheritedCaptionOverlaps(transcript.segments, transcript.segments) }))) } });
    await tx.project.update({ where: { id: project.id }, data: { status: 'completed', stage: 'ready', error: null } });
  });
}
