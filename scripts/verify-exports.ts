import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { db } from '../src/lib/db';
import { config } from '../src/lib/config';
import { storage } from '../src/lib/storage';
import { probe, runProcess } from '../src/lib/media';
import type { RenderSpec } from '../src/lib/render';

async function fastStart(file: string) {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat(); let position = 0;
    while (position + 8 <= size) {
      const buffer = Buffer.alloc(16); await handle.read(buffer, 0, 16, position);
      let length = buffer.readUInt32BE(0); const type = buffer.toString('ascii', 4, 8);
      if (type === 'moov') return true; if (type === 'mdat') return false;
      if (length === 1) length = Number(buffer.readBigUInt64BE(8));
      if (length < 8 || !Number.isSafeInteger(length)) return false;
      position += length;
    }
    return false;
  } finally { await handle.close(); }
}
function audioAlignment(source: Buffer, clip: Buffer) {
  const samples = Math.min(source.length, clip.length) / 2; let best = -1; let lagMs = 0;
  for (let lag = -3200; lag <= 3200; lag += 8) {
    let xy = 0; let xx = 0; let yy = 0;
    for (let i = 3200; i < samples - 3200; i += 4) {
      const x = source.readInt16LE(i * 2); const y = clip.readInt16LE((i + lag) * 2);
      xy += x * y; xx += x * x; yy += y * y;
    }
    const correlation = xx && yy ? xy / Math.sqrt(xx * yy) : 0;
    if (correlation > best) { best = correlation; lagMs = lag / 8; }
  }
  return { correlation: Number(best.toFixed(4)), lagMs, verified: best > 0.8 && Math.abs(lagMs) <= 50 };
}
const streamsSchema = z.object({ streams: z.array(z.object({ codec_type: z.string(), codec_name: z.string(), pix_fmt: z.string().optional(), start_time: z.coerce.number().optional() })) });
async function main() {
  const directory = path.resolve('data/export-checks'); await mkdir(directory, { recursive: true });
  const renders = await db.render.findMany({ where: { status: 'completed', key: { not: null }, project: { deletedAt: null } }, orderBy: { createdAt: 'desc' }, take: 5 });
  if (!renders.length) throw new Error('No completed exports are stored. Render a clip first.');
  const report = [];
  for (const render of renders) {
    const spec = render.spec as unknown as RenderSpec; const file = storage.path(render.key!);
    const media = await probe(file);
    assert.equal(media.width, spec.output.width); assert.equal(media.height, spec.output.height);
    assert.ok(Math.abs(media.durationMs - (spec.endMs - spec.startMs)) < 500, 'Duration differs from the selected interval.');
    const raw = streamsSchema.parse(JSON.parse(await runProcess(config.FFPROBE_PATH, ['-v', 'error', '-show_streams', '-of', 'json', file])));
    assert.ok(raw.streams.some(s => s.codec_type === 'video' && s.codec_name === 'h264' && s.pix_fmt === 'yuv420p'));
    assert.ok(raw.streams.some(s => s.codec_type === 'audio' && s.codec_name === 'aac'));
    assert.ok(await fastStart(file), 'MP4 metadata must precede video data for fast-start playback.');
    await runProcess(config.FFMPEG_PATH, ['-v', 'error', '-i', file, '-f', 'null', '-']);
    const seconds = Math.min(4, (spec.endMs - spec.startMs) / 1000 - 1);
    let alignment: ReturnType<typeof audioAlignment> | null = null;
    const temporary = path.join(directory, randomUUID());
    try {
      if (seconds >= 2) {
        for (const [input, start, suffix] of [[storage.path(spec.sourceKey), spec.startMs / 1000 + .5, 'source'], [file, .5, 'clip']] as const) {
          await runProcess(config.FFMPEG_PATH, ['-y', '-v', 'error', '-ss', String(start), '-i', input, '-t', String(seconds), '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', `${temporary}-${suffix}.pcm`]);
        }
        alignment = audioAlignment(await readFile(`${temporary}-source.pcm`), await readFile(`${temporary}-clip.pcm`));
      }
    } finally { await rm(`${temporary}-source.pcm`, { force: true }); await rm(`${temporary}-clip.pcm`, { force: true }); }
    const frames = [];
    for (const at of [.5, Math.min(3, (spec.endMs - spec.startMs) / 2000)]) {
      const frame = path.join(directory, `${render.id}-${at}.png`);
      await runProcess(config.FFMPEG_PATH, ['-y', '-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', frame]); frames.push(frame);
    }
    const entry = { renderId: render.id, durationMs: media.durationMs, width: media.width, height: media.height, fullDecode: true, fastStart: true, codecs: 'H.264/AAC/yuv420p', captionPreset: spec.settings.preset, audioAlignment: alignment, frames };
    report.push(entry); console.log(JSON.stringify(entry));
  }
  await writeFile(path.join(directory, 'report.json'), JSON.stringify({ checkedAt: new Date().toISOString(), renders: report, limitation: 'Audio alignment compares the export to the source interval; it does not judge original lip sync, sentence meaning, or caption accuracy. Inspect frames and listen to exports for those.' }, null, 2));
  if (report.some(r => r.audioAlignment && !r.audioAlignment.verified)) console.log('At least one audio sample needs manual review (silence or weak correlation can prevent an automatic check).');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
