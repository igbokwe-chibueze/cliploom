import { readdir, stat, rm } from 'node:fs/promises';
import { db } from '../src/lib/db';
import { config } from '../src/lib/config';
import { acquireWorker, claimJob, heartbeat, recoverStaleJobs, workerOwner } from '../src/lib/jobs';
import { processJob } from '../src/lib/pipeline';
import { safeError, temporaryFailure } from '../src/lib/providers';
import { storage } from '../src/lib/storage';
import { checkTools } from '../src/lib/media';

let stopping = false; let active: AbortController | undefined;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { stopping = true; active?.abort(); });
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function cleanupDeleted() {
  for (const p of await db.project.findMany({ where: { deletedAt: { not: null } } })) {
    await storage.removeProject(p.id);
    await db.project.delete({ where: { id: p.id } });
  }
}
async function cleanupOrphanUploads() {
  const cutoff = Date.now() - 24 * 60 * 60_000;
  const directories = await readdir(config.storageDir, { withFileTypes: true }).catch(() => []);
  for (const entry of directories) {
    if (!entry.isDirectory() || !/^[a-zA-Z0-9_-]+$/.test(entry.name)) continue;
    const folder = storage.path(entry.name);
    if ((await stat(folder)).mtimeMs >= cutoff || await db.project.findUnique({ where: { id: entry.name } })) continue;
    // storage.path verifies that the resolved directory stays inside the storage root.
    await rm(folder, { recursive: true, force: true });
  }
}
async function main() {
  await checkTools();
  if (!await acquireWorker()) throw new Error('Another worker holds the lease. Stop it or wait for the lease to expire.');
  await cleanupOrphanUploads();
  console.log(`Worker ready (${config.AI_MODE}). Single-worker queue; no live calls until upload.`);
  while (!stopping) {
    await heartbeat(); await recoverStaleJobs(); await cleanupDeleted();
    const job = await claimJob();
    if (!job) { await pause(1000); continue; }
    active = new AbortController(); const signal = active.signal;
    let ticking = false;
    const timer = setInterval(async () => { if (ticking) return; ticking = true; try { await heartbeat(job.id); } catch { active?.abort(); } finally { ticking = false; } }, 2000);
    try {
      console.log(`Job ${job.id}: ${job.type}`);
      await processJob(job.id, signal); signal.throwIfAborted();
      await db.job.updateMany({ where: { id: job.id, status: 'running' }, data: { status: 'succeeded', stage: 'completed', leaseUntil: null, error: null } });
    } catch (error) {
      const project = await db.project.findUnique({ where: { id: job.projectId } });
      const retry = !signal.aborted && temporaryFailure(error) && job.attempts < config.JOB_MAX_ATTEMPTS;
      const cancelled = !project || !!project.deletedAt;
      const message = stopping ? 'Worker stopped. Retry to resume saved stages.' : safeError(error);
      await db.job.updateMany({ where: { id: job.id, status: 'running' }, data: { status: cancelled ? 'cancelled' : retry || stopping ? 'queued' : 'failed', error: message, leaseUntil: null, runAfter: new Date(Date.now() + 3000 * 2 ** job.attempts) } });
      if (!cancelled && !retry && !stopping) {
        if (job.type === 'render') await db.render.updateMany({ where: { id: job.renderId! }, data: { status: 'failed', error: message } });
        else await db.project.updateMany({ where: { id: job.projectId }, data: { status: 'failed', error: message } });
      }
      console.log(`Job ${job.id}: ${cancelled ? 'cancelled' : retry ? 'retry queued' : 'failed'}`);
    } finally { clearInterval(timer); active = undefined; }
  }
}
main().catch(error => { console.error(safeError(error)); process.exitCode = 1; }).finally(async () => { await db.workerLock.deleteMany({ where: { id: 'single', owner: workerOwner } }).catch(() => {}); await db.$disconnect(); });
