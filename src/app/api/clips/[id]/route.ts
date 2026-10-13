import { z } from 'zod';
import { db } from '@/lib/db';
import { settingsSchema, prepareClipCaptions, transcriptSchema, validateInterval } from '@/lib/domain';
import { createRenderSpec } from '@/lib/render';
import { requireLocal, errorResponse } from '@/lib/server-api';

const editSchema = z.object({ title: z.string().min(1).max(160), startMs: z.number().int(), endMs: z.number().int(), settings: settingsSchema });
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  try {
    requireLocal(request); const id = (await context.params).id;
    const clip = await db.clip.findUniqueOrThrow({ where: { id }, include: { project: { include: { transcript: true } } } });
    if (clip.project.deletedAt) throw new Error('Project deleted.');
    const edit = editSchema.parse(await request.json()); validateInterval(edit.startMs, edit.endMs, clip.project.durationMs);
    const original = transcriptSchema.parse(clip.project.transcript!.original);
    edit.settings.captions = prepareClipCaptions(edit.settings.captions, original.segments, clip.project.durationMs, edit.startMs, edit.endMs);
    await db.$transaction(async tx => {
      await tx.clip.update({ where: { id }, data: { title: edit.title, startMs: edit.startMs, endMs: edit.endMs, settings: JSON.parse(JSON.stringify(edit.settings)), revision: { increment: 1 } } });
      await tx.render.updateMany({ where: { clipId: id, status: 'completed' }, data: { status: 'outdated' } });
      const edited = transcriptSchema.parse(clip.project.transcript!.edited);
      const corrections = new Map(edit.settings.captions.map(c => [c.id, c]));
      const segments = edited.segments.map(s => corrections.get(s.id) ?? s);
      await tx.transcript.update({ where: { projectId: clip.projectId }, data: { edited: JSON.parse(JSON.stringify({ segments, words: original.words })), version: { increment: 1 } } });
    });
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    requireLocal(request); const id = (await context.params).id;
    const clip = await db.clip.findUniqueOrThrow({ where: { id }, include: { project: { include: { assets: true, transcript: true } } } });
    if (clip.project.deletedAt) throw new Error('Project deleted.');
    const source = clip.project.assets.find(a => a.kind === 'source')!;
    const settings = settingsSchema.parse(clip.settings);
    settings.captions = prepareClipCaptions(settings.captions, transcriptSchema.parse(clip.project.transcript!.original).segments, clip.project.durationMs, clip.startMs, clip.endMs);
    const spec = createRenderSpec(source, { startMs: clip.startMs, endMs: clip.endMs, revision: clip.revision }, clip.project.width, clip.project.height, settings);
    const render = await db.$transaction(async tx => {
      const render = await tx.render.upsert({ where: { clipId_revision: { clipId: id, revision: clip.revision } }, create: { projectId: clip.projectId, clipId: id, revision: clip.revision, spec: JSON.parse(JSON.stringify(spec)) }, update: {} });
      const job = await tx.job.upsert({ where: { idempotencyKey: `render:${render.id}` }, create: { projectId: clip.projectId, type: 'render', renderId: render.id, idempotencyKey: `render:${render.id}` }, update: {} });
      if (job.status === 'failed') { await tx.job.update({ where: { id: job.id }, data: { status: 'queued', attempts: 0, error: null, runAfter: new Date() } }); await tx.render.update({ where: { id: render.id }, data: { status: 'queued', error: null } }); }
      return render;
    });
    return Response.json({ id: render.id });
  } catch (error) { return errorResponse(error); }
}
