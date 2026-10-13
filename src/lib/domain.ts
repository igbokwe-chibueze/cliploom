import { z } from 'zod';

export const wordSchema = z.object({ text: z.string().max(300), startMs: z.number().int().nonnegative(), endMs: z.number().int().nonnegative() });
export const cueSchema = wordSchema.extend({ id: z.string(), words: z.array(wordSchema).optional() });
export const transcriptSchema = z.object({ segments: z.array(cueSchema), words: z.array(wordSchema) });
export type Word = z.infer<typeof wordSchema>;
export type Cue = z.infer<typeof cueSchema>;
export type TranscriptData = z.infer<typeof transcriptSchema>;
export const settingsSchema = z.object({
  aspect: z.enum(['original', 'portrait']).default('portrait'),
  cropX: z.number().min(0).max(1).default(0.5),
  preset: z.enum(['clean', 'boxed', 'highlight']).default('clean'),
  fontSize: z.number().int().min(16).max(72).default(36),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#ffffff'),
  position: z.enum(['top', 'middle', 'bottom']).default('bottom'),
  captions: z.array(cueSchema).max(5000).default([]),
});
export type ClipSettings = z.infer<typeof settingsSchema>;
export type Suggestion = { title: string; reason: string; startMs: number; endMs: number };
export const selectionSchema = z.object({ clips: z.array(z.object({
  title: z.string().min(1).max(160), reason: z.string().min(1).max(600),
  startSegmentId: z.string(), endSegmentId: z.string(),
})).max(10) });

export function validateInterval(startMs: number, endMs: number, durationMs: number) {
  if (![startMs, endMs, durationMs].every(Number.isInteger) || startMs < 0 || endMs <= startMs || endMs > durationMs || endMs - startMs > 180_000) {
    throw new Error('Choose a valid interval within the source, between 0 and 180 seconds long.');
  }
}
export function validateCues(cues: Cue[], durationMs: number) {
  let previous = -1;
  for (const cue of cues) {
    if (cue.startMs < previous || cue.endMs <= cue.startMs || cue.endMs > durationMs || cue.text.length > 300) throw new Error('Caption timings must be ordered and within the source.');
    previous = cue.endMs;
  }
}
// Provider word boundaries can overlap across caption groups. Repair only inherited
// timing pairs; deliberately edited overlaps must still be reported to the user.
export function normalizeInheritedCaptionOverlaps(cues: Cue[], original: Cue[]): Cue[] {
  const baseline = new Map(original.map(c => [c.id, c]));
  const result = cues.map(c => ({ ...c }));
  for (let i = 1; i < result.length; i++) {
    const previous = result[i - 1]; const current = result[i];
    if (previous.endMs <= current.startMs) continue;
    const priorPrevious = baseline.get(previous.id); const priorCurrent = baseline.get(current.id);
    if (priorPrevious?.startMs === previous.startMs && priorPrevious.endMs === previous.endMs &&
        priorCurrent?.startMs === current.startMs && current.startMs > previous.startMs) {
      result[i - 1] = { ...previous, endMs: current.startMs, words: undefined };
    }
  }
  return result;
}
export function prepareClipCaptions(cues: Cue[], original: Cue[], durationMs: number, startMs: number, endMs: number): Cue[] {
  const normalized = normalizeInheritedCaptionOverlaps(normalizeEdits(cues, original), original);
  for (const cue of normalized) validateCues([cue], durationMs);
  // Keep the full editable copy for later boundary adjustments, but unrelated
  // overlaps outside this clip must not prevent this clip from saving/exporting.
  const relevant = normalized.filter(c => c.endMs > startMs && c.startMs < endMs);
  validateCues(relevant, durationMs);
  return normalized;
}
export function resolveSelection(raw: unknown, transcript: TranscriptData, durationMs: number, count: number): Suggestion[] {
  const { clips } = selectionSchema.parse(raw);
  const result: Suggestion[] = [];
  for (const clip of clips) {
    const first = transcript.segments.find(s => s.id === clip.startSegmentId);
    const last = transcript.segments.find(s => s.id === clip.endSegmentId);
    if (!first || !last) throw new Error('The model returned an unknown transcript boundary.');
    validateInterval(first.startMs, last.endMs, durationMs);
    const candidate = { title: clip.title, reason: clip.reason, startMs: first.startMs, endMs: last.endMs };
    if (result.some(s => Math.max(0, Math.min(s.endMs, candidate.endMs) - Math.max(s.startMs, candidate.startMs)) / Math.min(s.endMs - s.startMs, candidate.endMs - candidate.startMs) > 0.25)) continue;
    result.push(candidate);
  }
  return result.slice(0, count);
}

// Deduplicate only matching speech at the same global moment; later repetitions remain.
export function mergeChunks(chunks: { offsetMs: number; data: TranscriptData }[], durationMs: number): TranscriptData {
  const words: Word[] = [];
  const segments: Cue[] = [];
  for (const chunk of chunks.sort((a, b) => a.offsetMs - b.offsetMs)) {
    for (const word of chunk.data.words) {
      const w = { ...word, startMs: Math.max(0, word.startMs + chunk.offsetMs), endMs: Math.min(durationMs, word.endMs + chunk.offsetMs) };
      if (w.endMs <= w.startMs) continue;
      if (!words.slice(-80).some(p => p.text.trim().toLowerCase() === w.text.trim().toLowerCase() && Math.abs(p.startMs - w.startMs) < 600 && Math.min(p.endMs, w.endMs) > Math.max(p.startMs, w.startMs))) words.push(w);
    }
    for (const s of chunk.data.segments) {
      const cue = { ...s, startMs: Math.max(0, s.startMs + chunk.offsetMs), endMs: Math.min(durationMs, s.endMs + chunk.offsetMs) };
      if (cue.endMs > cue.startMs && !segments.some(p => p.text.trim() === cue.text.trim() && Math.abs(p.startMs - cue.startMs) < 1200)) segments.push(cue);
    }
  }
  words.sort((a, b) => a.startMs - b.startMs);
  // Word timings form consistent segment boundaries across chunk seams.
  const cues = words.length ? groupWords(words) : segments.sort((a, b) => a.startMs - b.startMs).map((s, i) => ({ ...s, id: `s${i}` }));
  return { words, segments: cues };
}
export function groupWords(words: Word[]): Cue[] {
  const cues: Cue[] = [];
  let group: Word[] = [];
  const flush = () => { if (group.length) cues.push({ id: `s${cues.length}`, text: group.map(w => w.text).join(' '), startMs: group[0].startMs, endMs: group.at(-1)!.endMs, words: group }); group = []; };
  for (const word of words) {
    if (group.length && (word.startMs - group.at(-1)!.endMs > 700 || group.map(w => w.text).join(' ').length + word.text.length > 52)) flush();
    group.push(word);
    if (/[.!?]$/.test(word.text) || group.length >= 9) flush();
  }
  flush();
  return cues;
}
export function captionCues(cues: Cue[], startMs: number, endMs: number): Cue[] {
  return cues.filter(c => c.endMs > startMs && c.startMs < endMs).map(c => {
    const included = c.words?.filter(w => w.endMs > startMs && w.startMs < endMs);
    return { ...c,
      text: included && included.length !== c.words?.length ? included.map(w => w.text).join(' ') : c.text,
      startMs: Math.max(c.startMs, startMs) - startMs, endMs: Math.min(c.endMs, endMs) - startMs,
      words: included?.map(w => ({ ...w, startMs: Math.max(w.startMs, startMs) - startMs, endMs: Math.min(w.endMs, endMs) - startMs })),
    };
  });
}
export function normalizeEdits(cues: Cue[], original: Cue[]): Cue[] {
  return cues.map(c => {
    const prior = original.find(p => p.id === c.id);
    // Corrected text/timing falls back to phrase captions; never guess word alignment.
    return { ...c, words: prior && prior.text === c.text && prior.startMs === c.startMs && prior.endMs === c.endMs ? prior.words : undefined };
  });
}
export function outputGeometry(width: number, height: number, settings: ClipSettings) {
  const even = (v: number) => Math.max(2, Math.floor(v / 2) * 2);
  const cropWidth = settings.aspect === 'portrait' ? Math.min(width, height * 9 / 16) : width;
  const cropHeight = settings.aspect === 'portrait' ? Math.min(height, width * 16 / 9) : height;
  const scale = Math.min(1, 720 / cropWidth, 1280 / cropHeight);
  return { cropWidth: even(cropWidth), cropHeight: even(cropHeight), cropLeft: Math.max(0, Math.floor((width - even(cropWidth)) * settings.cropX / 2) * 2), width: even(cropWidth * scale), height: even(cropHeight * scale) };
}
export function selectionUnits(segments: Cue[]) {
  const units: { startSegmentId: string; endSegmentId: string; startMs: number; endMs: number; text: string }[] = [];
  let group: Cue[] = [];
  const flush = () => { if (group.length) units.push({ startSegmentId: group[0].id, endSegmentId: group.at(-1)!.id, startMs: group[0].startMs, endMs: group.at(-1)!.endMs, text: group.map(s => s.text).join(' ') }); group = []; };
  for (const segment of segments) {
    if (group.length && segment.startMs - group.at(-1)!.endMs > 2000) flush();
    group.push(segment);
    if (/[.!?]["']?$/.test(segment.text.trim()) || group.map(s => s.text).join(' ').length > 900) flush();
  }
  flush(); return units;
}
