import assert from 'node:assert/strict';
import test from 'node:test';
import { errorCategory, retryDelayMs, safeError, temporaryFailure, withRetry } from '../src/lib/providers/errors';
import { workerHealth, jobFeedback } from '../src/lib/job-feedback';
import { initialClipCount, validClipCount } from '../src/features/projects/clip-count';

test('clip choice survives slow initial settings, navigation and invalid saved values', () => {
  assert.equal(initialClipCount('2', 5, null), 2);
  assert.equal(initialClipCount(null, 5, 2), 2);
  assert.equal(initialClipCount('8', 5, 2), 2);
  assert.equal(initialClipCount('invalid', 5, null), 5);
  for (const invalid of ['', null, undefined, NaN, 0, 11, 2.5, '2.5']) assert.equal(validClipCount(invalid), null);
});
test('worker heartbeat freshness differs from lease ownership', () => {
  const now = Date.parse('2026-10-14T10:00:00Z');
  assert.equal(workerHealth(new Date(now + 89_000), 90, now).workerState, 'online');
  assert.equal(workerHealth(new Date(now + 70_000), 90, now).workerState, 'recovering');
  assert.equal(workerHealth(new Date(now - 1), 90, now).workerState, 'offline');
  assert.equal(workerHealth(null, 90, now).workerOnline, false);
});
test('processing feedback distinguishes offline, queued, active, retrying and failed jobs', () => {
  const now = Date.now(); const job = { status: 'queued', stage: 'select-clips', attempts: 0, runAfter: new Date(now).toISOString(), error: null };
  assert.equal(jobFeedback(job, 'offline', now).title, 'Waiting for the worker');
  assert.equal(jobFeedback(job, 'recovering', now).title, 'Recovering the worker');
  assert.equal(jobFeedback(job, 'online', now).title, 'Queued for processing');
  assert.equal(jobFeedback({ ...job, status: 'running' }, 'online', now).active, true);
  const retry = jobFeedback({ ...job, attempts: 1, error: 'Temporary overload.', runAfter: new Date(now + 20_000).toISOString() }, 'online', now);
  assert.equal(retry.title, 'Waiting to retry'); assert.match(retry.detail, /20 seconds/);
  assert.equal(jobFeedback({ ...job, status: 'failed', error: 'Quota exhausted.' }, 'online', now).title, 'Processing paused');
});
test('provider overload and rate limits differ from exhausted allowance and access failures', () => {
  assert.equal(errorCategory({ status: 503 }), 'unavailable');
  assert.match(safeError({ status: 503 }, 'Gemini'), /Gemini is temporarily overloaded/);
  assert.equal(temporaryFailure({ status: 503 }), true);
  assert.equal(errorCategory({ status: 429, message: 'Too many requests' }), 'rate_limit');
  assert.equal(temporaryFailure({ status: 429, message: 'Quota exceeded; limit: 0' }), false);
  assert.equal(errorCategory({ status: 402 }), 'quota');
  assert.equal(errorCategory({ status: 429, message: 'Quota exceeded; check billing details; free_tier_requests_per_minute; limit: 10' }), 'rate_limit');
  assert.equal(temporaryFailure({ status: 401 }), false);
  assert.equal(temporaryFailure({ status: 403 }), false);
  assert.equal(temporaryFailure({ status: 404 }), false);
  assert.match(safeError({ status: 404 }, 'Gemini'), /No fallback/);
  assert.equal(errorCategory({ cause: { code: 'ECONNRESET' } }), 'network');
  assert.equal(errorCategory({ status: 504 }), 'timeout');
});
test('Retry-After seconds and HTTP dates are respected beyond normal backoff', () => {
  const now = Date.parse('2026-10-14T10:00:00Z');
  assert.ok(retryDelayMs({ status: 429, headers: new Headers({ 'retry-after': '120' }) }, 1, now, 0) >= 120_000);
  assert.equal(retryDelayMs({ status: 429, message: JSON.stringify({ details: [{ retryDelay: '180s' }] }) }, 1, now, 0), 180_000);
  assert.ok(retryDelayMs({ status: 503, headers: { 'retry-after': 'Wed, 14 Oct 2026 10:03:00 GMT' } }, 1, now, 0) >= 180_000);
});
test('long provider retry delays hand off to the durable queue and auth is not retried', async () => {
  let calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw { status: 429, headers: new Headers({ 'retry-after': '120' }) }; }));
  assert.equal(calls, 1);
  await assert.rejects(withRetry(async () => { calls++; throw { status: 401 }; }));
  assert.equal(calls, 2);
  const stopped = new AbortController(); stopped.abort();
  await assert.rejects(withRetry(async () => { calls++; return 1; }, stopped.signal)); assert.equal(calls, 2);
});
test('safe errors do not expose keys, local paths, URLs or raw provider bodies', () => {
  const text = safeError(new Error('Could not load C:\\private\\media.mp4 gsk_secret AIzaSecret https://example.com?key=secret'));
  assert.ok(!text.includes('gsk_secret')); assert.ok(!text.includes('AIzaSecret')); assert.ok(!text.includes('C:\\private')); assert.ok(!text.includes('key=secret'));
});
