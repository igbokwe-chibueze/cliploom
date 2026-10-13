import assert from 'node:assert/strict';
import test from 'node:test';
import { captionCues, normalizeInheritedCaptionOverlaps, prepareClipCaptions, groupWords, mergeChunks, normalizeEdits, outputGeometry, resolveSelection, settingsSchema, selectionUnits, validateCues, validateInterval, type TranscriptData } from '../src/lib/domain';
import { makeAss, createRenderSpec } from '../src/lib/render';
import { temporaryFailure } from '../src/lib/providers';
const data: TranscriptData = { words: [{ text: 'Hello.', startMs: 0, endMs: 1000 }, { text: 'Again.', startMs: 2000, endMs: 3000 }], segments: [{ id: 's0', text: 'Hello.', startMs: 0, endMs: 1000 }, { id: 's1', text: 'Again.', startMs: 2000, endMs: 3000 }] };
test('interval validation rejects nonfinite, reversed, fractional and out-of-range values', () => {
  for (const [start, end] of [[-1, 1000], [1000, 0], [0, 4000], [0.5, 1000], [NaN, 1], [0, Infinity]]) assert.throws(() => validateInterval(start, end, 3000));
  assert.doesNotThrow(() => validateInterval(0, 3000, 3000));
});
test('structured selections require real segment IDs and remove overlapping suggestions', () => {
  const clip = { title: 'Moment', reason: 'Complete thought', startSegmentId: 's0', endSegmentId: 's1' };
  assert.equal(resolveSelection({ clips: [clip, clip] }, data, 3000, 5).length, 1);
  assert.throws(() => resolveSelection({ clips: [{ ...clip, startSegmentId: 'invented' }] }, data, 3000, 5));
  assert.throws(() => resolveSelection({ clips: [{ ...clip, startSegmentId: 's1', endSegmentId: 's0' }] }, data, 3000, 5));
  assert.throws(() => resolveSelection({ clips: 'malformed' }, data, 3000, 5));
});
test('chunk merging rebases global timestamps and preserves legitimate later repeated speech', () => {
  const chunk = { words: [{ text: 'yes', startMs: 0, endMs: 600 }, { text: 'yes', startMs: 2000, endMs: 2600 }], segments: [] };
  const merged = mergeChunks([{ offsetMs: 0, data: chunk }, { offsetMs: 2000, data: chunk }], 5000);
  assert.deepEqual(merged.words.map(w => w.startMs), [0, 2000, 4000]);
  assert.equal(merged.words.length, 3);
});
test('cue clipping rebases words, and corrected speech loses fabricated word alignment', () => {
  const original = groupWords(data.words); const clipped = captionCues(original, 500, 2500);
  assert.equal(clipped[0].startMs, 0); assert.equal(clipped[0].words![0].startMs, 0);
  assert.equal(clipped.at(-1)!.endMs, 2000);
  assert.equal(normalizeEdits([{ ...original[0], text: 'Different words entirely.' }], original)[0].words, undefined);
  assert.throws(() => validateCues([{ ...original[0], endMs: 4000 }], 3000));
});
test('crop geometry stays in bounds for landscape and existing portrait footage', () => {
  const settings = settingsSchema.parse({ aspect: 'portrait', cropX: 1 });
  const g = outputGeometry(1280, 720, settings);
  assert.equal(g.width % 2, 0); assert.ok(g.cropLeft + g.cropWidth <= 1280); assert.ok(g.height <= 720);
  const portrait = outputGeometry(720, 1280, settings); assert.equal(portrait.cropLeft, 0); assert.equal(portrait.width, 720);
});
test('subtitle text cannot inject ASS tags or arbitrary filter arguments', () => {
  const settings = settingsSchema.parse({ captions: [{ id: 's0', startMs: 0, endMs: 1000, text: '{\\pos(0,0)} unsafe\\Nword' }] });
  const ass = makeAss(createRenderSpec({ id: 'source', key: 'p/source.mp4' }, { startMs: 0, endMs: 1000, revision: 1 }, 1280, 720, settings));
  assert.ok(!ass.includes('{\\pos')); assert.ok(!ass.includes('\\Nword')); assert.ok(ass.includes('Dialogue:'));
});
test('retry classification excludes auth and quota failures', () => {
  assert.equal(temporaryFailure({ status: 503 }), true); assert.equal(temporaryFailure({ status: 429, message: 'Rate limit' }), true);
  assert.equal(temporaryFailure({ status: 401 }), false); assert.equal(temporaryFailure({ status: 429, message: 'Insufficient quota' }), false);
});

test('selection units preserve sentence boundaries across caption groups', () => {
  const units = selectionUnits([{ id: 's0', text: 'A complete', startMs: 0, endMs: 1000 }, { id: 's1', text: 'thought.', startMs: 1000, endMs: 2000 }]);
  assert.equal(units.length, 1); assert.equal(units[0].startSegmentId, 's0'); assert.equal(units[0].endSegmentId, 's1');
});

const overlappingProviderCues = [
  { id: 's3', text: 'First phrase.', startMs: 21000, endMs: 24320, words: [{ text: 'phrase.', startMs: 23900, endMs: 24320 }] },
  { id: 's4', text: 'Second phrase.', startMs: 23980, endMs: 28160 },
  { id: 's35', text: 'Third phrase.', startMs: 103000, endMs: 105720 },
  { id: 's36', text: 'Fourth phrase.', startMs: 105400, endMs: 109540 },
  { id: 's38', text: 'Fifth phrase.', startMs: 112000, endMs: 113360 },
  { id: 's39', text: 'Sixth phrase.', startMs: 113260, endMs: 113580 },
];
test('real provider overlap regression: repairs 340/320/100ms in editable copy only', () => {
  const before = JSON.stringify(overlappingProviderCues);
  const repaired = prepareClipCaptions(overlappingProviderCues, overlappingProviderCues, 207442, 16220, 45640);
  assert.deepEqual([repaired[0].endMs, repaired[2].endMs, repaired[4].endMs], [23980, 105400, 113260]);
  assert.equal(repaired[0].words, undefined, 'A retimed cue must not pretend its original word alignment still applies');
  assert.doesNotThrow(() => validateCues(repaired, 207442));
  assert.equal(JSON.stringify(overlappingProviderCues), before);
  assert.deepEqual(normalizeInheritedCaptionOverlaps(repaired, overlappingProviderCues), repaired, 'Normalization is idempotent');
  assert.deepEqual(prepareClipCaptions(repaired, overlappingProviderCues, 207442, 16220, 45640), repaired);
});
test('unrelated edited overlaps cannot block an otherwise valid selected clip', () => {
  const original = overlappingProviderCues.map(c => ({ ...c }));
  const edited = original.map(c => c.id === 's36' ? { ...c, startMs: 105000 } : c);
  assert.doesNotThrow(() => prepareClipCaptions(edited, original, 207442, 16220, 45640));
  assert.throws(() => prepareClipCaptions(edited, original, 207442, 100000, 110000), /Caption timings/);
});
test('manual timing mistakes within the clip are rejected, not silently repaired', () => {
  const edited = overlappingProviderCues.map(c => c.id === 's4' ? { ...c, startMs: 23500 } : c);
  assert.throws(() => prepareClipCaptions(edited, overlappingProviderCues, 207442, 16220, 45640), /Caption timings/);
  assert.throws(() => prepareClipCaptions([{ id: 'bad', text: 'Reversed', startMs: 25000, endMs: 24000 }], [], 207442, 16220, 45640));
  const corrected = overlappingProviderCues.map(c => c.id === 's3' ? { ...c, text: 'Corrected text.' } : c);
  const prepared = prepareClipCaptions(corrected, overlappingProviderCues, 207442, 16220, 45640);
  assert.equal(prepared[0].text, 'Corrected text.');
  assert.equal(prepared[0].words, undefined);
  const spec = createRenderSpec({ id: 'source', key: 'p/source.mp4' }, { startMs: 16220, endMs: 45640, revision: 1 }, 1280, 720, settingsSchema.parse({ captions: prepared }));
  assert.doesNotThrow(() => validateCues(spec.cues, 45640 - 16220));
});
