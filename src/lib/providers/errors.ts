import { setTimeout as delay } from 'node:timers/promises';

type ErrorDetails = { status?: number; code?: string; message?: string; headers?: Headers | Record<string, string>; error?: unknown; cause?: unknown };
function details(error: unknown): ErrorDetails {
  return error && typeof error === 'object' ? error as ErrorDetails : {};
}
function signals(error: unknown) {
  const e = details(error);
  let body = e.message ?? '';
  try { body += ' ' + JSON.stringify(e.error ?? ''); } catch { /* Error bodies can contain cycles. */ }
  return { e, body };
}
export type ProviderErrorCategory = 'authentication' | 'quota' | 'permission' | 'model' | 'rate_limit' | 'timeout' | 'unavailable' | 'network' | 'invalid_request' | 'other';
export function errorCategory(error: unknown, depth = 0): ProviderErrorCategory {
  const { e, body } = signals(error);
  if (e.status === 401 || /API_KEY_INVALID|invalid.api.key|key.*leaked/i.test(body)) return 'authentication';
  if (e.status === 429 && /per[_ ]minute|per minute|requests_per_minute|tokens_per_minute/i.test(body) && !/limit:\s*0\b|insufficient|credits?.*(exhausted|depleted)/i.test(body)) return 'rate_limit';
  if (e.status === 402 || /insufficient.quota|insufficient_quota|billing|credits?.*(exhausted|depleted)|quota.*(exceeded|exhausted)|limit:\s*0\b/i.test(body)) return 'quota';
  if (e.status === 403) return 'permission';
  if (e.status === 404) return 'model';
  if (e.status === 429) return 'rate_limit';
  if (e.status === 408 || e.status === 504 || /timeout|timed.out/i.test(e.code ?? '') || e.code === 'ETIMEDOUT') return 'timeout';
  if ([500, 502, 503].includes(e.status ?? 0)) return 'unavailable';
  if (['ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND'].includes(e.code ?? '') || /fetch failed|network error/i.test(body)) return 'network';
  if (e.cause && e.cause !== error && depth < 3) { const category = errorCategory(e.cause, depth + 1); if (category !== 'other') return category; }
  if (e.status === 400 || e.status === 422) return 'invalid_request';
  return 'other';
}
export function temporaryFailure(error: unknown) {
  return ['rate_limit', 'timeout', 'unavailable', 'network'].includes(errorCategory(error));
}
export function retryAfterMs(error: unknown, now = Date.now()) {
  const headers = details(error).headers;
  const raw = headers && 'get' in headers && typeof headers.get === 'function' ? headers.get('retry-after') : (headers as Record<string, string> | undefined)?.['retry-after'];
  if (!raw) {
    const delay = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(signals(error).body);
    return delay ? Number(delay[1]) * 1000 : 0;
  }
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}
export function retryDelayMs(error: unknown, attempt: number, now = Date.now(), random = Math.random()) {
  return Math.max(retryAfterMs(error, now), Math.min(60_000, 3000 * 2 ** Math.min(attempt, 5)) + random * 1000);
}
export async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { signal?.throwIfAborted(); return await fn(); } catch (error) {
      if (signal?.aborted || attempt >= 2 || !temporaryFailure(error)) throw error;
      const wait = retryDelayMs(error, attempt);
      // A long Retry-After belongs in the durable queue, not a sleeping SDK call.
      if (wait > 60_000) throw error;
      await delay(wait, undefined, { signal });
    }
  }
}
export function safeError(error: unknown, provider = 'AI provider') {
  const category = errorCategory(error);
  const saved = 'Saved stages will be reused.';
  switch (category) {
    case 'authentication': return `${provider} rejected the API key. Check the server key, save the environment file and restart the worker before retrying. No fallback model was used.`;
    case 'permission': return `${provider} denied access. Check API/project permissions and model access before retrying. No fallback model was used.`;
    case 'model': return `${provider} could not find or allow the configured model. Verify the exact model ID and account access, then restart the worker. No fallback model was used.`;
    case 'quota': return `${provider} reports exhausted quota, unavailable free allowance, or a billing/credit restriction. Check the provider dashboard before retrying. Automatic retries stopped. ${saved}`;
    case 'rate_limit': return `${provider} is rate limiting requests (429). Wait for the scheduled retry or retry later after the provider allowance resets. ${saved}`;
    case 'unavailable': return `${provider} is temporarily overloaded or unavailable (${details(error).status ?? '5xx'}). Retry later; this does not establish that your credits are exhausted. ${saved}`;
    case 'timeout': return `${provider} did not respond before the timeout. Check your connection and retry later. ${saved}`;
    case 'network': return `Could not connect to ${provider}. Check your internet connection, firewall or proxy, then retry. ${saved}`;
    case 'invalid_request': return `${provider} rejected the request format or parameters (${details(error).status}). Check model compatibility and application configuration. ${saved}`;
  }
  const e = details(error);
  if (e.status) return `${provider} request failed (${e.status}). Retry after checking the provider service. ${saved}`;
  return (e.message ?? 'Processing failed. Retry the saved stage.')
    .replace(/(?:https?:\/\/)[^\s]+/g, '[service URL]')
    .replace(/(?:AIza[\w-]+|gsk_[\w-]+|sk-[\w-]+)/g, '[redacted key]')
    .replace(/[A-Za-z]:[\\/][^\n]+/g, '[local path]').slice(0, 450);
}
