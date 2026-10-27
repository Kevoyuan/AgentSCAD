import { ModelRequestError } from "@/lib/model-runtime";

/**
 * Retry one model generation call when the provider connection itself drops.
 *
 * A transport reset (ECONNRESET / undici socket failures) is transient and
 * retryable in a way that a schema, auth, or truncation failure is not. Keep the
 * retry bounded and abortable so a cancelled job still stops immediately.
 */
const TRANSPORT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

export interface ModelTransportRetryInfo {
  /** Transport code that triggered the retry (for example ECONNRESET). */
  code: string;
  /** 1-based number of the attempt that failed. */
  attempt: number;
  /** Total attempts allowed by this call. */
  attempts: number;
  error: unknown;
}

export interface ModelTransportRetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  signal?: AbortSignal;
  onRetry?: (info: ModelTransportRetryInfo) => void;
}

function codeFromObject(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as { code?: unknown }).code;
  return typeof candidate === "string" && TRANSPORT_ERROR_CODES.has(candidate)
    ? candidate
    : null;
}

const TRANSPORT_MESSAGE_PATTERN =
  /(?:socket connection was closed|other side closed|fetch failed|connection reset|network error|terminated)/i;

/**
 * Return the transport code that makes a model error safe to retry, if any.
 * Checks structured evidence first, then the wrapped cause chain (fetch wrappers
 * hide the original ECONNRESET inside TypeError("terminated")).
 */
export function getModelTransportRetryCode(error: unknown): string | null {
  if (!(error instanceof ModelRequestError)) return null;
  if (error.evidence?.transportCode && TRANSPORT_ERROR_CODES.has(error.evidence.transportCode)) {
    return error.evidence.transportCode;
  }

  const chain: Array<Record<string, unknown>> = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current && typeof current === "object" && !seen.has(current); depth += 1) {
    seen.add(current);
    const nested = current as Record<string, unknown>;
    chain.push(nested);
    current = nested.cause;
  }

  for (const nested of chain) {
    const direct = codeFromObject(nested);
    if (direct) return direct;
  }
  for (const nested of chain) {
    const message = nested.message;
    if (typeof message === "string" && TRANSPORT_MESSAGE_PATTERN.test(message)) {
      return "UND_ERR_SOCKET";
    }
  }
  return null;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) {
    return Promise.reject(new DOMException("Model request was cancelled", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Model request was cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function retryModelTransport<T>(
  operation: () => Promise<T>,
  options: ModelTransportRetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 2));
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 1_500);

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const code = getModelTransportRetryCode(error);
      if (!code || attempt >= attempts || options.signal?.aborted) throw error;

      options.onRetry?.({ code, attempt, attempts, error });
      await delay(baseDelayMs * 2 ** (attempt - 1), options.signal);
    }
  }
}
