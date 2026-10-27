import { AsyncLocalStorage } from "node:async_hooks";

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
  transportCode?: string;
  elapsedMs?: number;
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

  // Node fetch may wrap ECONNRESET inside TypeError("terminated"). Preserve
  // only known transport codes, never arbitrary cause text containing secrets.
  const transportCodes = new Set(["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);
  // undici sometimes drops the code and only leaves a socket text on the caused
  // TypeError ("The socket connection was closed unexpectedly..."). Classify the
  // shape, then report a fixed transport code rather than echoing raw cause text.
  const transportMessagePattern = /(?:socket connection was closed|other side closed|fetch failed|connection reset|network error|terminated)/i;
  const chain: Array<Record<string, unknown>> = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current && typeof current === "object" && !seen.has(current); depth++) {
    seen.add(current);
    const nested = current as Record<string, unknown>;
    chain.push(nested);
    current = nested.cause;
  }

  for (const nested of chain) {
    if (typeof nested.code === "string" && transportCodes.has(nested.code)) {
      return new ModelRequestError(
        "LLM_UNAVAILABLE",
        `The connection to the model provider was interrupted (${nested.code}) before generation completed. Check the connection or retry the request.`,
        true,
        { cause, evidence: { transportCode: nested.code } },
      );
    }
  }
  for (const nested of chain) {
    if (typeof nested.message === "string" && transportMessagePattern.test(nested.message)) {
      return new ModelRequestError(
        "LLM_UNAVAILABLE",
        "The connection to the model provider was interrupted (UND_ERR_SOCKET) before generation completed. Check the connection or retry the request.",
        true,
        { cause, evidence: { transportCode: "UND_ERR_SOCKET" } },
      );
    }
  }

  return new ModelRequestError(
    "LLM_UNAVAILABLE",
    "The model provider could not generate OpenSCAD for this request. Test the provider or select another model, then retry.",
    true,
    { cause },
  );
}

// ---------------------------------------------------------------------------
// LLM call accounting
//
// `Job.llmCallCount` is only meaningful if *every* model call is counted from
// one place. `createChatCompletionDetailed` in `lib/tools/model-router.ts` is
// that place: intake, request research, generation, compile repair and visual
// repair all funnel through it. Counting here means a new call site is counted
// automatically instead of being silently missed.
//
// The counter is scoped to one async execution (one job run) because a Node
// process serves many jobs at once. Calls made outside a run scope are simply
// not counted — losing a count must never break generation.
//
// Attempts are counted when the request starts, not when it succeeds: a retry
// costs the same budget as the call that finally worked, so cost attribution
// has to see both.
// ---------------------------------------------------------------------------

interface LlmCallMeter {
  calls: number;
}

const llmCallMeterStorage = new AsyncLocalStorage<LlmCallMeter>();

/**
 * Runs `fn` with a fresh counter bound to that execution. Everything `fn`
 * awaits shares the counter; concurrent runs keep theirs separate.
 *
 * Scoped with `run` rather than `enterWith` on purpose: `enterWith` mutates the
 * store of the *current* async resource, so the counter would leak back into
 * the caller and any sibling job the caller starts afterwards. That is exactly
 * the contamination this metric is meant to avoid.
 */
export function withLlmCallMeter<T>(fn: () => Promise<T>): Promise<T> {
  return llmCallMeterStorage.run({ calls: 0 }, fn);
}

/** Records one model call into the current run scope, if there is one. */
export function countLlmCall(): void {
  const meter = llmCallMeterStorage.getStore();
  if (meter) meter.calls += 1;
}

/** Model calls recorded so far in the current run scope. 0 outside a scope. */
export function llmCallsThisRun(): number {
  return llmCallMeterStorage.getStore()?.calls ?? 0;
}
