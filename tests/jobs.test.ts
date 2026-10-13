import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';

test('persistent queue deduplicates, claims once, recovers stale leases and excludes deleted projects', async () => {
  const file = path.resolve(`data/test-${randomUUID()}.db`);
  process.env.DATABASE_URL = `file:${file.replaceAll('\\', '/')}`;
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe', windowsHide: true });
  const { db } = await import('../src/lib/db');
  const { acquireWorker, claimJob, enqueue, recoverStaleJobs, workerOwner } = await import('../src/lib/jobs');
  try {
    const project = await db.project.create({ data: { name: 'Queue test', mode: 'fixture' } });
    const first = await enqueue(project.id, 'process', 'unique-test'); const second = await enqueue(project.id, 'process', 'unique-test');
    assert.equal(first.id, second.id); assert.equal(await db.job.count(), 1);
    assert.equal(await acquireWorker(), true);
    await db.workerLock.update({ where: { id: 'single' }, data: { owner: 'different-worker' } }); assert.equal(await acquireWorker(), false);
    await db.workerLock.update({ where: { id: 'single' }, data: { owner: workerOwner } });
    const claims = await Promise.all([claimJob(), claimJob()]); assert.equal(claims.filter(Boolean).length, 1);
    await db.job.update({ where: { id: first.id }, data: { leaseUntil: new Date(0), stage: 'transcribe' } });
    await recoverStaleJobs(); const recovered = await db.job.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(recovered.status, 'queued'); assert.equal(recovered.stage, 'transcribe');
    await claimJob(); await db.job.update({ where: { id: first.id }, data: { attempts: 99, leaseUntil: new Date(0) } });
    await recoverStaleJobs(); assert.equal((await db.job.findUniqueOrThrow({ where: { id: first.id } })).status, 'failed');
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: project.id } })).status, 'failed');
    await db.project.update({ where: { id: project.id }, data: { deletedAt: new Date() } });
    await db.job.update({ where: { id: first.id }, data: { status: 'queued' } }); assert.equal(await claimJob(), null);
  } finally { await db.$disconnect(); for (const suffix of ['', '-wal', '-shm', '-journal']) await rm(file + suffix, { force: true }); }
});
