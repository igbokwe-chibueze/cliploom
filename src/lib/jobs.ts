import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { db } from './db';
import { config } from './config';

export const workerOwner = randomUUID();
const lease = () => new Date(Date.now() + config.JOB_LEASE_SECONDS * 1000);
export async function acquireWorker() {
  await db.workerLock.upsert({ where: { id: 'single' }, create: { id: 'single', owner: '', leaseUntil: new Date(0) }, update: {} });
  const result = await db.workerLock.updateMany({ where: { id: 'single', OR: [{ leaseUntil: { lt: new Date() } }, { owner: workerOwner }] }, data: { owner: workerOwner, leaseUntil: lease() } });
  return result.count === 1;
}
export async function recoverStaleJobs(now = new Date()) {
  await db.job.updateMany({ where: { status: 'running', leaseUntil: { lt: now }, attempts: { lt: config.JOB_MAX_ATTEMPTS } }, data: { status: 'queued', leaseUntil: null, runAfter: now, error: 'Recovered after a worker restart.' } });
  const exhausted = await db.job.findMany({ where: { status: 'running', leaseUntil: { lt: now }, attempts: { gte: config.JOB_MAX_ATTEMPTS } } });
  for (const job of exhausted) {
    const message = 'Worker stopped repeatedly. Retry to resume saved stages.';
    await db.$transaction(async tx => {
      await tx.job.update({ where: { id: job.id }, data: { status: 'failed', leaseUntil: null, error: message } });
      if (job.type === 'render' && job.renderId) await tx.render.updateMany({ where: { id: job.renderId }, data: { status: 'failed', error: message } });
      else await tx.project.updateMany({ where: { id: job.projectId, deletedAt: null }, data: { status: 'failed', error: message } });
    });
  }
}
export async function waitForWorkerLease(signal: AbortSignal, onWait: () => void = () => {}) {
  let reported = false;
  while (!signal.aborted) {
    if (await acquireWorker()) return;
    if (!reported) { onWait(); reported = true; }
    await delay(1000, undefined, { signal });
  }
  signal.throwIfAborted();
}
export async function claimJob() {
  return db.$transaction(async tx => {
    const lock = await tx.workerLock.findUnique({ where: { id: 'single' } });
    if (!lock || lock.owner !== workerOwner || lock.leaseUntil <= new Date()) throw new Error('Worker lease lost.');
    const candidate = await tx.job.findFirst({ where: { status: 'queued', runAfter: { lte: new Date() }, project: { deletedAt: null } }, orderBy: { createdAt: 'asc' } });
    if (!candidate) return null;
    const claimed = await tx.job.updateMany({ where: { id: candidate.id, status: 'queued' }, data: { status: 'running', attempts: { increment: 1 }, leaseUntil: lease(), error: null } });
    return claimed.count ? tx.job.findUniqueOrThrow({ where: { id: candidate.id } }) : null;
  });
}
export async function heartbeat(jobId?: string) {
  const held = await db.workerLock.updateMany({ where: { id: 'single', owner: workerOwner, leaseUntil: { gt: new Date() } }, data: { leaseUntil: lease() } });
  if (!held.count) throw new Error('Worker lease lost.');
  if (jobId) {
    const job = await db.job.findUnique({ where: { id: jobId }, include: { project: true } });
    if (!job || job.status !== 'running' || job.project.deletedAt) throw new Error('Job cancelled.');
    await db.job.update({ where: { id: jobId }, data: { leaseUntil: lease() } });
  }
}
export async function enqueue(projectId: string, type: 'process' | 'select' | 'render', idempotencyKey: string, renderId?: string) {
  return db.job.upsert({ where: { idempotencyKey }, create: { projectId, type, idempotencyKey, renderId }, update: {} });
}
