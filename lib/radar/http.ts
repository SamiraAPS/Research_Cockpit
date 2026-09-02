import { SOURCE_RETRY_ATTEMPTS } from "./config/search.v3";

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export class SourceRequestError extends Error {
  constructor(
    readonly source: string,
    message: string,
    readonly latencyMs: number,
    readonly httpStatus: number | null,
    readonly attempts: number,
  ) {
    super(message);
    this.name = "SourceRequestError";
  }
}

export type RetryingFetchOptions = {
  source: string;
  fetchImpl?: typeof fetch;
  init?: RequestInit;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
};

export type RetryingFetchResult = {
  response: Response;
  latencyMs: number;
  attempts: number;
};

function retryAfterMs(response: Response) {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function fetchWithRetry(url: URL | string, options: RetryingFetchOptions): Promise<RetryingFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxAttempts = Math.max(1, options.maxAttempts ?? SOURCE_RETRY_ATTEMPTS);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 500);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 30_000);
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        ...options.init,
        signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
      });
      if (response.ok) return { response, latencyMs: Date.now() - startedAt, attempts: attempt };
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === maxAttempts) {
        throw new SourceRequestError(options.source, `${options.source} returned ${response.status}`, Date.now() - startedAt, response.status, attempt);
      }
      const delay = retryAfterMs(response) ?? baseDelayMs * 2 ** (attempt - 1);
      await sleep(Math.min(delay, maxDelayMs));
    } catch (error) {
      if (error instanceof SourceRequestError) throw error;
      lastError = error;
      if (attempt === maxAttempts) break;
      await sleep(Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs));
    }
  }

  const message = lastError instanceof Error ? lastError.message : `${options.source} request failed`;
  throw new SourceRequestError(options.source, message, Date.now() - startedAt, null, maxAttempts);
}

