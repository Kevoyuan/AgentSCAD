export const MIN_MODEL_REQUEST_TIMEOUT_MS = 5_000;
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

export type ModelErrorCode =
  | "LLM_TIMEOUT"
  | "LLM_AUTH_ERROR"
  | "LLM_RATE_LIMITED"
  | "LLM_UNAVAILABLE"
  | "LLM_OUTPUT_TRUNCATED"
  | "LLM_FORMAT_INVALID"
  | "LLM_EMPTY_RESPONSE";

export interface ModelErrorEvidence {
  model?: string;
  provider?: string;
  finishReason?: string;
  responseLength?: number;
  rawSnippet?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
  };
}

export function createControlledSnippet(content: string | undefined | null, maxLength = 800): string {
  if (!content) return "";
  const cleaned = content.trim();
  if (cleaned.length <= maxLength) return cleaned;
  const half = Math.floor((maxLength - 50) / 2);
  const head = cleaned.slice(0, half);
  const tail = cleaned.slice(-half);
  const omitted = cleaned.length - head.length - tail.length;
  return `${head}\n... [truncated ${omitted} chars] ...\n${tail}`;
}

export class ModelRequestError extends Error {
  readonly code: ModelErrorCode;
  readonly retryable: boolean;
  readonly evidence?: ModelErrorEvidence;

  constructor(
    code: ModelErrorCode,
    message: string,
    retryable: boolean,
    options?: ErrorOptions & { evidence?: ModelErrorEvidence },
  ) {
    super(message, options);
    this.name = "ModelRequestError";
    this.code = code;
    this.retryable = retryable;
    this.evidence = options?.evidence;
  }
}

export function getModelRequestTimeoutMs(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number | null {
  const raw = env.AGENTSCAD_LLM_TIMEOUT_MS?.trim();
  if (!raw || raw === "0") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.min(
    Math.max(Math.round(parsed), MIN_MODEL_REQUEST_TIMEOUT_MS),
    MAX_TIMER_DELAY_MS,
  );
}

export function createModelRequestSignal(
  signal?: AbortSignal,
  timeoutMs = getModelRequestTimeoutMs(),
): AbortSignal | undefined {
  // A caller-provided signal owns the operation's deadline (for example the
  // visual-repair route's 120-second budget). Do not silently shorten it with
  // an optional operator-configured timeout. Without either, model execution
  // remains unbounded at the application layer.
  if (signal) return signal;
  if (timeoutMs === null) return undefined;
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
      timeoutMs === null
        ? "Model generation timed out before it completed. Retry or check the provider's own request limits."
        : `Model generation timed out after ${Math.round(timeoutMs / 1_000)} seconds. Retry or increase AGENTSCAD_LLM_TIMEOUT_MS.`,
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
