import {
  createControlledSnippet,
  ModelRequestError,
  type ModelErrorEvidence,
} from "@/lib/model-runtime";

/**
 * Accumulate an OpenAI-compatible SSE chat completion stream into one response.
 *
 * Long CAD generations (for example a full engine assembly) can take minutes.
 * Requesting `stream: true` keeps bytes flowing through the provider connection
 * instead of leaving a non-streaming body idle until the upstream gateway resets
 * it, which is what produced the repeated ECONNRESET failures at ~240s.
 */
export interface StreamedCompletion {
  content: string;
  reasoningContent?: string;
  finishReason?: string;
  model?: string;
  usage?: ModelErrorEvidence["usage"];
}

export interface StreamReadOptions {
  provider: string;
  model?: string;
  signal?: AbortSignal;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is Record<string, unknown> => Boolean(part) && typeof part === "object")
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("");
}

function parseUsage(value: unknown): ModelErrorEvidence["usage"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const completionDetails = usage.completion_tokens_details as Record<string, unknown> | undefined;
  const parsed = {
    promptTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : undefined,
    completionTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : undefined,
    totalTokens: typeof usage.total_tokens === "number" ? usage.total_tokens : undefined,
    reasoningTokens: typeof completionDetails?.reasoning_tokens === "number"
      ? completionDetails.reasoning_tokens
      : undefined,
  };
  return Object.values(parsed).some((entry) => entry !== undefined) ? parsed : undefined;
}

function streamError(
  provider: string,
  model: string | undefined,
  message: string,
  rawSnippet?: string,
): ModelRequestError {
  return new ModelRequestError(
    "LLM_UNAVAILABLE",
    message,
    true,
    {
      evidence: {
        provider,
        model,
        ...(rawSnippet ? { rawSnippet } : {}),
      },
    },
  );
}

export async function readOpenAiCompatibleStream(
  response: Response,
  options: StreamReadOptions,
): Promise<StreamedCompletion> {
  const body = response.body;
  if (!body) {
    throw streamError(options.provider, options.model, `${options.provider} returned an empty streaming response.`);
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const contentParts: string[] = [];
  const reasoningParts: string[] = [];
  let buffer = "";
  let finishReason: string | undefined;
  let resolvedModel = options.model;
  let usage: ModelErrorEvidence["usage"];
  let sawDone = false;

  const handleDataLine = (rawData: string): void => {
    const data = rawData.trim();
    if (!data || sawDone) return;
    if (data === "[DONE]") {
      sawDone = true;
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      throw streamError(
        options.provider,
        resolvedModel,
        `${options.provider} sent a malformed stream chunk.`,
        createControlledSnippet(data),
      );
    }

    if (!payload || typeof payload !== "object") return;
    const chunk = payload as Record<string, unknown>;

    if (typeof chunk.model === "string" && chunk.model.trim()) {
      resolvedModel = chunk.model.trim();
    }
    const parsedUsage = parseUsage(chunk.usage);
    if (parsedUsage) usage = parsedUsage;

    if (chunk.error && typeof chunk.error === "object") {
      const errorObject = chunk.error as Record<string, unknown>;
      const errorMessage = typeof errorObject.message === "string"
        ? errorObject.message
        : JSON.stringify(chunk.error);
      throw streamError(
        options.provider,
        resolvedModel,
        `${options.provider} stream failed: ${errorMessage}`,
        createControlledSnippet(errorMessage),
      );
    }

    const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
    const choice = choices[0] as Record<string, unknown> | undefined;
    if (!choice) return;

    const delta = choice.delta && typeof choice.delta === "object"
      ? choice.delta as Record<string, unknown>
      : {};
    const message = choice.message && typeof choice.message === "object"
      ? choice.message as Record<string, unknown>
      : {};

    const deltaText =
      textFromContent(delta.content)
      || textFromContent(message.content)
      || (typeof choice.text === "string" ? choice.text : "");
    if (deltaText) contentParts.push(deltaText);

    const reasoningText = typeof delta.reasoning_content === "string"
      ? delta.reasoning_content
      : typeof message.reasoning_content === "string"
        ? message.reasoning_content
        : "";
    if (reasoningText) reasoningParts.push(reasoningText);

    if (typeof choice.finish_reason === "string") {
      finishReason = choice.finish_reason;
    }
  };

  const drainCompleteLines = (flushRemainder = false): void => {
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      let line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line && !line.startsWith(":") && line.startsWith("data:")) {
        handleDataLine(line.slice(5));
      }
      newlineIndex = buffer.indexOf("\n");
    }
    if (flushRemainder && buffer.trim()) {
      const line = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
      buffer = "";
      if (line.startsWith("data:")) handleDataLine(line.slice(5));
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      drainCompleteLines();
    }
    buffer += decoder.decode();
    drainCompleteLines(true);
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // The stream may already be closed by the provider reset.
    }
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Reader already released or cancelled.
    }
  }

  return {
    content: contentParts.join(""),
    ...(reasoningParts.length > 0 ? { reasoningContent: reasoningParts.join("") } : {}),
    ...(finishReason ? { finishReason } : {}),
    ...(resolvedModel ? { model: resolvedModel } : {}),
    ...(usage ? { usage } : {}),
  };
}
