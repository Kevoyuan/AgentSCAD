import {
  createMimoChatCompletion,
  getMimoConfig,
  MIMO_DEFAULT_MODEL,
  type MimoMessage,
} from "@/lib/mimo";
import { createDeepSeekChatCompletion } from "@/lib/deepseek";
import {
  createOpenRouterChatCompletion,
  isOpenRouterModel,
} from "@/lib/openrouter";
import { parseJsonObject } from "@/lib/harness/structured-output";
import {
  createProviderChatCompletion,
  findProviderForModel,
} from "@/lib/provider-settings";
import {
  createModelRequestSignal,
  getModelRequestTimeoutMs,
  ModelRequestError,
  normalizeModelRequestError,
  createControlledSnippet,
  type ModelErrorEvidence,
} from "@/lib/model-runtime";

export interface ModelRouterRequest {
  messages: MimoMessage[];
  model?: string;
  stream?: boolean;
  preferMimo?: boolean;
  signal?: AbortSignal;
}

export interface ModelCompletionResponse {
  content: string;
  model: string;
  provider: string;
  finishReason?: string;
  responseLength: number;
  rawSnippet: string;
  reasoningContent?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
  };
}

export function unpackProviderChatCompletionDetailed(
  result: unknown,
  providerLabel = "Model provider",
  fallbackModel?: string,
): ModelCompletionResponse {
  if (typeof result === "string" && result.trim()) {
    const raw = result.trim();
    return {
      content: raw,
      model: fallbackModel || "unknown",
      provider: providerLabel,
      finishReason: "stop",
      responseLength: raw.length,
      rawSnippet: createControlledSnippet(raw),
    };
  }

  if (!result || typeof result !== "object") {
    throw new ModelRequestError(
      "LLM_UNAVAILABLE",
      `${providerLabel} returned an empty or invalid response.`,
      true,
      {
        evidence: {
          provider: providerLabel,
          model: fallbackModel,
          responseLength: 0,
        },
      },
    );
  }

  const res = result as Record<string, unknown>;
  const resolvedModel = typeof res.model === "string" && res.model.trim()
    ? res.model.trim()
    : (fallbackModel || "unknown");

  let usage: ModelErrorEvidence["usage"] = undefined;
  if (res.usage && typeof res.usage === "object") {
    const u = res.usage as Record<string, unknown>;
    const promptDetails = u.prompt_tokens_details as Record<string, unknown> | undefined;
    const completionDetails = u.completion_tokens_details as Record<string, unknown> | undefined;
    usage = {
      promptTokens: typeof u.prompt_tokens === "number" ? u.prompt_tokens : undefined,
      completionTokens: typeof u.completion_tokens === "number" ? u.completion_tokens : undefined,
      totalTokens: typeof u.total_tokens === "number" ? u.total_tokens : undefined,
      reasoningTokens: typeof completionDetails?.reasoning_tokens === "number"
        ? completionDetails.reasoning_tokens
        : undefined,
    };
  }

  if (res.error && typeof res.error === "object") {
    const errObj = res.error as Record<string, unknown>;
    const errMsg = typeof errObj.message === "string" ? errObj.message : JSON.stringify(res.error);
    const code = String(errObj.code || "");
    const status = (errObj as { status?: number }).status;
    const evidence: ModelErrorEvidence = {
      model: resolvedModel,
      provider: providerLabel,
      rawSnippet: createControlledSnippet(errMsg),
      usage,
    };

    if (code === "invalid_api_key" || status === 401 || status === 403) {
      throw new ModelRequestError(
        "LLM_AUTH_ERROR",
        `${providerLabel} authentication failed: ${errMsg}`,
        false,
        { evidence },
      );
    }
    if (code === "rate_limit_exceeded" || status === 429) {
      throw new ModelRequestError(
        "LLM_RATE_LIMITED",
        `${providerLabel} rate limited: ${errMsg}`,
        true,
        { evidence },
      );
    }
    throw new ModelRequestError(
      "LLM_UNAVAILABLE",
      `${providerLabel} request failed: ${errMsg}`,
      true,
      { evidence },
    );
  }

  if (Array.isArray(res.choices) && res.choices.length > 0) {
    const choice = res.choices[0] as Record<string, unknown>;
    const finishReason = typeof choice.finish_reason === "string" ? choice.finish_reason : undefined;
    const message = choice.message as Record<string, unknown> | undefined;

    let contentStr: string | null = null;

    if (typeof message?.content === "string") {
      contentStr = message.content;
    } else if (Array.isArray(message?.content)) {
      const textParts = (message.content as Record<string, unknown>[])
        .filter((part) => part?.type === "text" && typeof part?.text === "string")
        .map((part) => part.text as string);
      contentStr = textParts.join("\n");
    } else if (typeof choice.text === "string") {
      contentStr = choice.text;
    } else if (typeof (choice.delta as Record<string, unknown> | undefined)?.content === "string") {
      contentStr = (choice.delta as Record<string, unknown>).content as string;
    }

    const reasoningContent = typeof message?.reasoning_content === "string" && message.reasoning_content.trim()
      ? message.reasoning_content.trim()
      : undefined;

    const trimmedContent = contentStr?.trim() || "";

    if (trimmedContent) {
      return {
        content: contentStr!,
        model: resolvedModel,
        provider: providerLabel,
        finishReason,
        responseLength: contentStr!.length,
        rawSnippet: createControlledSnippet(contentStr!),
        reasoningContent,
        usage,
      };
    }

    // If content is empty but reasoning_content exists, use reasoningContent as content
    if (reasoningContent) {
      return {
        content: reasoningContent,
        model: resolvedModel,
        provider: providerLabel,
        finishReason,
        responseLength: reasoningContent.length,
        rawSnippet: createControlledSnippet(reasoningContent),
        reasoningContent,
        usage,
      };
    }

    const evidence: ModelErrorEvidence = {
      model: resolvedModel,
      provider: providerLabel,
      finishReason,
      responseLength: 0,
      usage,
    };

    if (finishReason === "length") {
      throw new ModelRequestError(
        "LLM_OUTPUT_TRUNCATED",
        `${providerLabel} output was truncated before completion (finish_reason: length).`,
        true,
        { evidence },
      );
    }

    if (finishReason === "content_filter" || finishReason === "refusal") {
      throw new ModelRequestError(
        "LLM_UNAVAILABLE",
        `${providerLabel} request was filtered or refused by safety rules (finish_reason: ${finishReason}).`,
        false,
        { evidence },
      );
    }

    throw new ModelRequestError(
      "LLM_EMPTY_RESPONSE",
      `${providerLabel} returned an empty message (finish_reason: ${finishReason || "unknown"}).`,
      true,
      { evidence },
    );
  }

  if (typeof res.output === "string" && res.output.trim()) {
    const raw = res.output.trim();
    return {
      content: raw,
      model: resolvedModel,
      provider: providerLabel,
      finishReason: "stop",
      responseLength: raw.length,
      rawSnippet: createControlledSnippet(raw),
      usage,
    };
  }
  if (typeof res.text === "string" && res.text.trim()) {
    const raw = res.text.trim();
    return {
      content: raw,
      model: resolvedModel,
      provider: providerLabel,
      finishReason: "stop",
      responseLength: raw.length,
      rawSnippet: createControlledSnippet(raw),
      usage,
    };
  }

  throw new ModelRequestError(
    "LLM_EMPTY_RESPONSE",
    `${providerLabel} returned no output content or choices.`,
    true,
    {
      evidence: {
        model: resolvedModel,
        provider: providerLabel,
        responseLength: 0,
        usage,
      },
    },
  );
}

export function unpackProviderChatCompletionResponse(
  result: unknown,
  providerLabel = "Model provider",
  fallbackModel?: string,
): string {
  return unpackProviderChatCompletionDetailed(result, providerLabel, fallbackModel).content;
}

export function hasImageInput(messages: MimoMessage[]): boolean {
  return messages.some((message) =>
    Array.isArray(message.content)
    && message.content.some((part) => part.type === "image_url"),
  );
}

function waitForModel<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("Model request timed out", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("Model request timed out", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export async function createChatCompletionDetailed({
  messages,
  model,
  stream = false,
  preferMimo = true,
  signal,
}: ModelRouterRequest): Promise<ModelCompletionResponse> {
  const timeoutMs = getModelRequestTimeoutMs();
  const requestSignal = createModelRequestSignal(signal, timeoutMs);

  try {
    const configuredProvider = await findProviderForModel(model);
    if (configuredProvider) {
      const providerResponse = await createProviderChatCompletion({
        provider: configuredProvider.provider,
        model: configuredProvider.model,
        messages,
        stream,
        signal: requestSignal,
      });
      const result = await providerResponse.json();
      return unpackProviderChatCompletionDetailed(
        result,
        configuredProvider.provider.name,
        configuredProvider.model,
      );
    }

    if (isOpenRouterModel(model)) {
      const openRouterResponse = await createOpenRouterChatCompletion({
        model,
        messages,
        stream,
        signal: requestSignal,
      });
      const result = await openRouterResponse.json();
      return unpackProviderChatCompletionDetailed(result, "OpenRouter", model);
    }

    if (model?.startsWith("deepseek-")) {
      const deepSeekResponse = await createDeepSeekChatCompletion({
        model,
        messages,
        stream,
        signal: requestSignal,
      });
      const result = await deepSeekResponse.json();
      return unpackProviderChatCompletionDetailed(result, "DeepSeek", model);
    }

    if (preferMimo && getMimoConfig().enabled) {
      const selectedModel = model || process.env.MIMO_MODEL || MIMO_DEFAULT_MODEL;
      const mimoResponse = await createMimoChatCompletion({
        model: selectedModel,
        messages,
        stream,
        signal: requestSignal,
      });
      const result = await mimoResponse.json();
      return unpackProviderChatCompletionDetailed(result, "MiMo", selectedModel);
    }

    if (hasImageInput(messages)) {
      throw new Error(
        "Visual requests require a configured multimodal provider; text-only fallback is disabled",
      );
    }

    const ZAIModule = await import("z-ai-web-dev-sdk");
    const ZAI = ZAIModule.default;
    const zai = await waitForModel(ZAI.create(), requestSignal);

    const result = await waitForModel(zai.chat.completions.create({
      messages: messages.map((message) => ({
        role:
          message.role === "system" || message.role === "assistant"
            ? message.role
            : "user",
        content:
          typeof message.content === "string"
            ? message.content
            : message.content
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("\n"),
      })),
      stream,
    }), requestSignal);

    return unpackProviderChatCompletionDetailed(result, "Fallback provider", "zai-default");
  } catch (error) {
    throw normalizeModelRequestError(error, timeoutMs);
  }
}

export async function createChatCompletionWithFallback(
  request: ModelRouterRequest
): Promise<string> {
  const detailed = await createChatCompletionDetailed(request);
  return detailed.content;
}

export async function callModelText(request: ModelRouterRequest): Promise<string> {
  return createChatCompletionWithFallback(request);
}

export async function callModelJson<T>(
  request: ModelRouterRequest,
  fallback: T
): Promise<T> {
  const text = await callModelText(request);
  return parseJsonObject<T>(text, fallback);
}
