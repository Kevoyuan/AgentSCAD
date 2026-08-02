export const DEFAULT_MODEL_REQUEST_TIMEOUT_MS = 90_000;
export const MIN_MODEL_REQUEST_TIMEOUT_MS = 5_000;
export const MAX_MODEL_REQUEST_TIMEOUT_MS = 240_000;

export type ModelErrorCode =
  | "LLM_TIMEOUT"
  | "LLM_AUTH_ERROR"
  | "LLM_RATE_LIMITED"
  | "LLM_UNAVAILABLE";

export class ModelRequestError extends Error {
  readonly code: ModelErrorCode;
  readonly retryable: boolean;

  constructor(
    code: ModelErrorCode,
    message: string,
    retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ModelRequestError";
    this.code = code;
    this.retryable = retryable;
  }
}
export function getModelRequestTimeoutMs(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const raw = env.AGENTSCAD_LLM_TIMEOUT_MS?.trim();
  const parsed = raw ? Number(raw) : DEFAULT_MODEL_REQUEST_TIMEOUT_MS;
  if (!Number.isFinite(parsed)) return DEFAULT_MODEL_REQUEST_TIMEOUT_MS;
  return Math.min(
    Math.max(Math.round(parsed), MIN_MODEL_REQUEST_TIMEOUT_MS),
    MAX_MODEL_REQUEST_TIMEOUT_MS,
  );
}

export function createModelRequestSignal(
  signal?: AbortSignal,
  timeoutMs = getModelRequestTimeoutMs(),
): AbortSignal {
  // A caller-provided signal owns the operation's deadline (for example the
  // visual-repair route's 120-second budget). Do not silently shorten it with
  // the router's default timeout; callers without a deadline still receive a
  // bounded signal below.
  if (signal) return signal;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return timeoutSignal;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function normalizeModelRequestError(
  error: unknown,
  timeoutMs = getModelRequestTimeoutMs(),
): ModelRequestError {
  if (error instanceof ModelRequestError) return error;

  const message = errorMessage(error);
  const normalized = message.toLowerCase();
  const name = error instanceof Error ? error.name : "";
  const cause = error instanceof Error ? error : undefined;

  if (
    name === "TimeoutError"
    || name === "AbortError"
    || normalized.includes("timed out")
    || normalized.includes("timeout")
    || normalized.includes("operation was aborted")
  ) {
    return new ModelRequestError(
      "LLM_TIMEOUT",
      `Model generation timed out after ${Math.round(timeoutMs / 1_000)} seconds. Retry or choose a faster model.`,
      true,
      { cause },
    );
  }

  if (
    /\((401|403)\)/.test(message)
    || normalized.includes("api key is not configured")
    || normalized.includes("invalid api key")
    || normalized.includes("unauthorized")
  ) {
    return new ModelRequestError(
      "LLM_AUTH_ERROR",
      "The model provider rejected the API key or selected model. Test the provider settings and try again.",
      false,
      { cause },
    );
  }

  if (/\(429\)/.test(message) || normalized.includes("rate limit")) {
    return new ModelRequestError(
      "LLM_RATE_LIMITED",
      "The model provider is rate-limiting requests. Wait briefly, then retry.",
      true,
      { cause },
    );
  }

  return new ModelRequestError(
    "LLM_UNAVAILABLE",
    "The model provider could not generate OpenSCAD for this request. Test the provider or select another model, then retry.",
    true,
    { cause },
  );
}
