import { rm, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config';
import { captionCues, outputGeometry, type ClipSettings, type Cue } from './domain';
import { probe, runProcess } from './media';
import { storage } from './storage';

export type RenderSpec = { sourceAssetId: string; sourceKey: string; startMs: number; endMs: number; revision: number; sourceWidth: number; sourceHeight: number; settings: ClipSettings; output: ReturnType<typeof outputGeometry>; cues: Cue[] };
export function createRenderSpec(source: { id: string; key: string }, clip: { startMs: number; endMs: number; revision: number }, width: number, height: number, settings: ClipSettings): RenderSpec {
  return { sourceAssetId: source.id, sourceKey: source.key, ...clip, sourceWidth: width, sourceHeight: height, settings, output: outputGeometry(width, height, settings), cues: captionCues(settings.captions, clip.startMs, clip.endMs) };
}
const assTime = (ms: number) => { const cs = Math.floor(ms / 10); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
const assText = (text: string) => text.replaceAll('\\', '').replaceAll('{', '').replaceAll('}', '').replace(/[\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
const assColor = (hex: string) => `&H00${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`;
export function makeAss(spec: RenderSpec) {
  const { width, height } = spec.output; const s = spec.settings;
  const fontSize = s.fontSize * width / 720;
  const alignment = s.position === 'top' ? 8 : s.position === 'middle' ? 5 : 2;
  const margin = Math.round(height * 0.08);
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,${fontSize},${assColor(s.color)},&H0000DFFF,&H00111111,&H80000000,-1,0,0,0,100,100,0,0,${s.preset === 'boxed' ? 3 : 1},${Math.max(1, width / 360)},0,${alignment},${Math.round(width * .07)},${Math.round(width * .07)},${margin},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const events: string[] = [];
  const add = (start: number, end: number, text: string) => { if (end > start) events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${text}`); };
  for (const cue of spec.cues) {
    if (s.preset !== 'highlight' || !cue.words?.length) { add(cue.startMs, cue.endMs, assText(cue.text)); continue; }
    const points = [...new Set([cue.startMs, cue.endMs, ...cue.words.flatMap(w => [Math.max(cue.startMs, w.startMs), Math.min(cue.endMs, w.endMs)])])].sort((a, b) => a - b);
    for (let i = 0; i < points.length - 1; i++) {
      const t = points[i]; const text = cue.words.map(w => w.startMs <= t && w.endMs > t ? `{\\c&H00DFFF&}${assText(w.text)}{\\c${assColor(s.color)}&}` : assText(w.text)).join(' ');
      add(t, points[i + 1], text);
    }
  }
  return header + events.join('\n') + '\n';
}
export interface Renderer { render(spec: RenderSpec, projectId: string, renderId: string, signal: AbortSignal): Promise<{ key: string; bytes: number }> }
export const renderer: Renderer = {
  async render(spec, projectId, renderId, signal) {
    const { stat } = await import('node:fs/promises');
    const key = `${projectId}/renders/${renderId}.mp4`; const output = await storage.prepare(key);
    const cwd = path.dirname(output); const subtitleName = `${renderId}.ass`; const partial = output + '.partial.mp4';
    const g = spec.output;
    await writeFile(path.join(cwd, subtitleName), makeAss(spec), 'utf8');
    try {
      await runProcess(config.FFMPEG_PATH, ['-y', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe', '-ss', String(spec.startMs / 1000), '-i', storage.path(spec.sourceKey), '-t', String((spec.endMs - spec.startMs) / 1000), '-map', '0:v:0', '-map', '0:a:0', '-vf', `crop=${g.cropWidth}:${g.cropHeight}:${Math.max(0, g.cropLeft)}:(ih-oh)/2,scale=${g.width}:${g.height},setsar=1,ass=${subtitleName}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-fs', String(config.maxUploadBytes), partial], { cwd, signal });
      signal.throwIfAborted();
      const media = await probe(partial, signal);
      if (Math.abs(media.durationMs - (spec.endMs - spec.startMs)) > 1000 || media.width !== g.width || media.height !== g.height) throw new Error('Rendered media did not match the requested duration or dimensions.');
      await rename(partial, output);
      return { key, bytes: (await stat(output)).size };
    } finally { await rm(partial, { force: true }); await rm(path.join(cwd, subtitleName), { force: true }); }
  },
};
