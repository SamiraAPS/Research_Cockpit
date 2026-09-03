import { DEFAULT_RETRY_ATTEMPTS, DEFAULT_TIMEOUT_MS } from "./config.mjs";

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export class SourceRequestError extends Error {
  constructor(source, message, details = {}) {
    super(message);
    this.name = "SourceRequestError";
    this.source = source;
    this.httpStatus = details.httpStatus ?? null;
    this.attempts = details.attempts ?? 1;
    this.latencyMs = details.latencyMs ?? 0;
    this.rateLimitEvents = details.rateLimitEvents ?? 0;
  }
}

function retryAfterMs(response) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  return Number.isFinite(reset) ? Math.max(0, reset * 1_000) : null;
}

const defaultSleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function fetchWithRetry(url, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_RETRY_ATTEMPTS);
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 500);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 30_000);
  const source = options.source ?? "Quelle";
  const startedAt = Date.now();
  let rateLimitEvents = 0;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        ...options.init,
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (response.ok) {
        return {
          response,
          attempts: attempt,
          latencyMs: Date.now() - startedAt,
          rateLimitEvents
        };
      }

      if (response.status === 429) rateLimitEvents += 1;
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === maxAttempts) {
        throw new SourceRequestError(source, `${source} antwortete mit HTTP ${response.status}`, {
          httpStatus: response.status,
          attempts: attempt,
          latencyMs: Date.now() - startedAt,
          rateLimitEvents
        });
      }

      await response.body?.cancel().catch(() => {});
      const delay = retryAfterMs(response) ?? baseDelayMs * 2 ** (attempt - 1);
      await sleep(Math.min(delay, maxDelayMs));
    } catch (error) {
      if (error instanceof SourceRequestError) throw error;
      lastError = error;
      if (attempt === maxAttempts) break;
      await sleep(Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs));
    }
  }

  throw new SourceRequestError(source, lastError instanceof Error ? lastError.message : `${source} konnte nicht abgefragt werden`, {
    attempts: maxAttempts,
    latencyMs: Date.now() - startedAt,
    rateLimitEvents
  });
}
