import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { requireLocal, errorResponse } from '@/lib/server-api';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireLocal(request); const id = (await context.params).id; const url = new URL(request.url);
    const asset = url.searchParams.has('render') ? await db.render.findFirst({ where: { id, status: 'completed', project: { deletedAt: null } }, select: { key: true } }) : await db.mediaAsset.findFirst({ where: { id, project: { deletedAt: null } }, select: { key: true, mime: true } });
    if (!asset?.key) return new Response('Media not found', { status: 404 });
    const file = storage.path(asset.key); const { size } = await stat(file);
    const headers: Record<string, string> = { 'Content-Type': 'mime' in asset && typeof asset.mime === 'string' ? asset.mime : 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
    if (url.searchParams.has('download')) headers['Content-Disposition'] = `attachment; filename="clip-${id}.mp4"`;
    let start = 0; let end = size - 1; const range = request.headers.get('range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || !match[1] && !match[2]) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      if (!match[1]) start = Math.max(0, size - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      if (start > end || start >= size || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }
    headers['Content-Length'] = String(end - start + 1);
    const stream = createReadStream(file, { start, end });
    request.signal.addEventListener('abort', () => stream.destroy(), { once: true });
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: range ? 206 : 200, headers });
  } catch (error) { return errorResponse(error, 404); }
}
