import { randomUUID } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import { z } from 'zod';
import { db } from '@/lib/db';
import { config } from '@/lib/config';
import { storage } from '@/lib/storage';
import { requireLocal, errorResponse } from '@/lib/server-api';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  try { requireLocal(request); return Response.json(await db.project.findMany({ where: { deletedAt: null }, include: { assets: { select: { id: true, kind: true } }, _count: { select: { clips: true, renders: true } } }, orderBy: { createdAt: 'desc' } })); } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  const id = randomUUID(); let committed = false;
  try {
    requireLocal(request);
    const name = decodeURIComponent(request.headers.get('x-filename') ?? '');
    const extension = name.split('.').at(-1)?.toLowerCase();
    if (!extension || !['mp4', 'mov', 'webm'].includes(extension)) throw new Error('Choose an MP4, MOV, or WebM file.');
    if (Number(request.headers.get('content-length')) > config.maxUploadBytes) throw new Error(`Upload exceeds ${config.MAX_UPLOAD_MB} MB.`);
    const count = z.coerce.number().int().min(1).max(10).parse(request.headers.get('x-clip-count') ?? config.CLIP_COUNT);
    if (!request.body) throw new Error('The upload was empty.');
    const key = `${id}/source.${extension}`; const final = await storage.prepare(key); const temporary = final + '.upload';
    const file = await open(temporary, 'wx'); let bytes = 0;
    const reader = request.body.getReader();
    try { while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > config.maxUploadBytes) { await reader.cancel(); throw new Error(`Upload exceeds ${config.MAX_UPLOAD_MB} MB.`); } let offset = 0; while (offset < value.byteLength) { const written = await file.write(value, offset, value.byteLength - offset); if (!written.bytesWritten) throw new Error('Upload could not be written to disk.'); offset += written.bytesWritten; } } } finally { await file.close(); reader.releaseLock(); }
    if (!bytes) throw new Error('The upload was empty.');
    await rename(temporary, final);
    await db.project.create({ data: { id, name: name.replace(/[\x00-\x1f]/g, '').slice(0, 180), mode: config.AI_MODE, clipCount: count, assets: { create: { kind: 'source', key, bytes, mime: extension === 'webm' ? 'video/webm' : extension === 'mov' ? 'video/quicktime' : 'video/mp4' } }, jobs: { create: { type: 'process', idempotencyKey: `process:${id}` } } } });
    committed = true;
    return Response.json({ id, clipCount: count }, { status: 201 });
  } catch (error) { return errorResponse(error); } finally { if (!committed) await rm(storage.path(id), { recursive: true, force: true }).catch(() => {}); }
}
