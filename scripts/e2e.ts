import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { config } from '../src/lib/config';
import { probe, runProcess } from '../src/lib/media';
import { outputGeometry } from '../src/lib/domain';
import type { ProjectView, AppStatus } from '../src/features/projects/types';
import { createFixture } from './create-fixture';
const base = config.LOCAL_ORIGIN;
async function request<T>(url: string, init?: RequestInit): Promise<T> { const res = await fetch(base + url, { ...init, headers: { Origin: base, ...init?.headers } }); const data = await res.json(); if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`); return data; }
async function waitFor(id: string, done: (p: ProjectView) => boolean) { for (let i = 0; i < 180; i++) { const p = await request<ProjectView>(`/api/projects/${id}`); const failure = p.jobs.find(j => j.status === 'failed'); if (failure) throw new Error(failure.error ?? 'Job failed'); if (done(p)) return p; await new Promise(r => setTimeout(r, 1000)); } throw new Error('Timed out waiting for worker.'); }
async function main() {
  const status = await request<AppStatus>('/api/status'); assert.equal(status.mode, 'fixture', 'E2E requires AI_MODE=fixture. It will never call live providers.'); assert.equal(status.workerOnline, true, 'Start the worker first.');
  const file = await createFixture();
  const { id } = await request<{ id: string }>('/api/projects', { method: 'POST', headers: { 'x-filename': encodeURIComponent('Fixture source video.mp4'), 'Content-Type': 'application/octet-stream' }, body: await readFile(file) });
  console.log(`Uploaded fixture project ${id}`);
  let p = await waitFor(id, p => p.status === 'completed'); assert.equal(p.clips.length, 1); assert.equal(p.transcript!.provider, 'fixture');
  const clip = p.clips[0]; const original = JSON.stringify(p.transcript!.original);
  const settings = { ...clip.settings, aspect: 'portrait' as const, cropX: .2, preset: 'highlight' as const, fontSize: 42, captions: clip.settings.captions.map((c, i) => i === 0 ? { ...c, text: 'Fixture caption correction.' } : c) };
  await request(`/api/clips/${clip.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Fixture: verified portrait export', startMs: 500, endMs: 10_500, settings }) });
  const [one, two] = await Promise.all([request<{ id: string }>(`/api/clips/${clip.id}`, { method: 'POST' }), request<{ id: string }>(`/api/clips/${clip.id}`, { method: 'POST' })]); assert.equal(one.id, two.id, 'Repeated render clicks must deduplicate');
  p = await waitFor(id, p => p.clips[0].renders.some(r => r.status === 'completed'));
  assert.equal(JSON.stringify(p.transcript!.original), original); assert.equal(p.clips[0].settings.captions[0].words, undefined);
  const res = await fetch(`${base}/api/media/${one.id}?render=1&download=1`); assert.equal(res.status, 200); assert.match(res.headers.get('content-disposition') ?? '', /attachment/);
  const output = path.resolve('data/e2e/verified portrait.mp4'); await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, Buffer.from(await res.arrayBuffer()));
  const media = await probe(output); const geometry = outputGeometry(p.width, p.height, settings); assert.equal(media.width, geometry.width); assert.equal(media.height, geometry.height); assert.ok(Math.abs(media.durationMs - 10_000) < 500);
  await runProcess(config.FFMPEG_PATH, ['-v', 'error', '-i', output, '-f', 'null', '-']);
  const frame = path.resolve('data/e2e/caption preview.png'); await runProcess(config.FFMPEG_PATH, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '1', '-i', output, '-frames:v', '1', frame]);
  const range = await fetch(`${base}/api/media/${one.id}?render=1`, { headers: { Range: 'bytes=0-99' } }); assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 100);
  const badOrigin = await fetch(`${base}/api/projects/${id}`, { method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'retry' }) }); assert.equal(badOrigin.status, 400);
  if (process.env.E2E_SCREENSHOTS === '1' && process.platform === 'win32') {
    const browser = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    if (existsSync(browser)) execFileSync(browser, ['--headless', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--window-size=1440,1400', '--virtual-time-budget=7000', '--user-data-dir=' + path.resolve('data/browser-qa'), '--screenshot=' + path.resolve('data/e2e/editor.png'), base + '/projects/' + id], { timeout: 45_000, windowsHide: true, stdio: 'pipe' });
  }
  await request(`/api/projects/${id}`, { method: 'DELETE' }); const gone = await fetch(`${base}/api/projects/${id}`); assert.equal(gone.status, 404);
  console.log(`Verified actual render: ${media.width}x${media.height}, ${media.durationMs}ms; decode, range download, immutable transcript, duplicate export, origin check and deletion passed.\nSaved test artifact: ${output}\nCaption frame: ${frame}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
