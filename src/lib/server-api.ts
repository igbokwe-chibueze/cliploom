import 'server-only';
import { config } from './config';
import { db } from './db';

export function requireLocal(request: Request) {
  const allowed = new URL(config.LOCAL_ORIGIN);
  const url = new URL(request.url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port !== allowed.port) throw new Error('This prototype only accepts local requests on the configured port.');
  const origin = request.headers.get('origin');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    if (!origin) throw new Error('Missing local request origin.');
    const parsed = new URL(origin);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.port !== allowed.port || parsed.protocol !== allowed.protocol) throw new Error('Cross-origin requests are not allowed.');
  }
}
export function errorResponse(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : 'Request failed.';
  if (message.includes('prisma') || message.includes('Invocation') || message.includes('SQLITE')) return Response.json({ error: 'Database is unavailable. Run npm run db:setup and restart the app.' }, { status: 503 });
  return Response.json({ error: message.slice(0, 500) }, { status });
}
export async function getProject(id: string) {
  const project = await db.project.findFirst({ where: { id, deletedAt: null }, include: { assets: true, transcript: true, clips: { include: { renders: { orderBy: { createdAt: 'desc' } } }, orderBy: { startMs: 'asc' } }, jobs: { orderBy: { createdAt: 'desc' }, take: 30 } } });
  if (!project) throw new Error('Project not found.');
  return project;
}
