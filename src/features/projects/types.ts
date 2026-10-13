export type AssetView = { id: string; kind: string };
export type RenderView = { id: string; status: string; revision: number; error: string | null };
export type ClipView = { id: string; title: string; reason: string; startMs: number; endMs: number; revision: number; settings: import('@/lib/domain').ClipSettings; renders: RenderView[] };
export type ProjectView = { id: string; name: string; mode: 'fixture' | 'live'; status: string; stage: string; error: string | null; durationMs: number; width: number; height: number; createdAt: string; assets: AssetView[]; clips: ClipView[]; transcript: { original: import('@/lib/domain').TranscriptData; edited: import('@/lib/domain').TranscriptData; provider: string; model: string; usage: unknown } | null; jobs: { id: string; status: string; stage: string; type: string; error: string | null }[] };
export type ProjectCard = Pick<ProjectView, 'id' | 'name' | 'mode' | 'status' | 'stage' | 'durationMs' | 'createdAt' | 'assets'> & { _count: { clips: number; renders: number } };
export type AppStatus = { mode: 'fixture' | 'live'; workerOnline: boolean; maxUploadMB: number; maxDurationMinutes: number; keysConfigured: boolean; defaultClipCount: number };
export function timeLabel(ms: number) { const seconds = Math.floor(ms / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Request failed.'); return result as T;
}
