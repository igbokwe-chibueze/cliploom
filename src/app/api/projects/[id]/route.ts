import { z } from 'zod';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/jobs';
import { storage } from '@/lib/storage';
import { getProject, requireLocal, errorResponse } from '@/lib/server-api';

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try { requireLocal(request); return Response.json(await getProject((await context.params).id)); } catch (error) { return errorResponse(error, 404); }
}
export async function POST(request: Request, context: Context) {
  try {
    requireLocal(request); const project = await getProject((await context.params).id);
    const { action } = z.object({ action: z.enum(['retry', 'regenerate']) }).parse(await request.json());
    if (action === 'regenerate') {
      if (project.jobs.some(j => ['running', 'queued'].includes(j.status))) throw new Error('Wait for current jobs before regenerating.');
      if (!project.transcript) throw new Error('A saved transcript is required. Retry processing first.');
      const version = project.selectionVersion + 1;
      await db.$transaction(async tx => {
        await tx.clip.deleteMany({ where: { projectId: project.id } });
        await tx.project.update({ where: { id: project.id }, data: { selectionVersion: version, status: 'queued', stage: 'select-clips', error: null } });
        await tx.job.create({ data: { projectId: project.id, type: 'select', idempotencyKey: `select:${project.id}:${version}` } });
      });
    } else {
      const failed = project.jobs.filter(j => j.status === 'failed' && j.type !== 'render');
      if (failed.length) await db.job.updateMany({ where: { id: { in: failed.map(j => j.id) }, status: 'failed' }, data: { status: 'queued', attempts: 0, runAfter: new Date(), error: null } });
      else await enqueue(project.id, 'process', `process:${project.id}`);
      if (!project.jobs.some(j => j.status === 'running')) await db.project.update({ where: { id: project.id }, data: { status: 'queued', error: null } });
    }
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    requireLocal(request); const project = await getProject((await context.params).id);
    const running = project.jobs.some(j => j.status === 'running');
    await db.$transaction(async tx => {
      await tx.project.update({ where: { id: project.id }, data: { deletedAt: new Date(), status: 'deleted' } });
      await tx.job.updateMany({ where: { projectId: project.id, status: { in: ['queued', 'running'] } }, data: { status: 'cancelled' } });
    });
    // An active worker cancels its child process, then removes tombstoned media.
    if (!running) { await storage.removeProject(project.id); await db.project.delete({ where: { id: project.id } }); }
    return Response.json({ ok: true, cleanupPending: running });
  } catch (error) { return errorResponse(error); }
}
