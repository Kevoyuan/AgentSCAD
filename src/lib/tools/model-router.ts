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
  normalizeModelRequestError,
} from "@/lib/model-runtime";

export interface ModelRouterRequest {
  messages: MimoMessage[];
  model?: string;
  stream?: boolean;
  preferMimo?: boolean;
  signal?: AbortSignal;
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

export async function createChatCompletionWithFallback({
  messages,
  model,
  stream = false,
  preferMimo = true,
  signal,
}: ModelRouterRequest): Promise<string> {
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
      return result?.choices?.[0]?.message?.content ?? JSON.stringify(result);
    }

    if (isOpenRouterModel(model)) {
      const openRouterResponse = await createOpenRouterChatCompletion({
        model,
        messages,
        stream,
        signal: requestSignal,
      });
      const result = await openRouterResponse.json();
      return result?.choices?.[0]?.message?.content ?? JSON.stringify(result);
    }

    if (model?.startsWith("deepseek-")) {
      const deepSeekResponse = await createDeepSeekChatCompletion({
        model,
        messages,
        stream,
        signal: requestSignal,
      });
      const result = await deepSeekResponse.json();
      return result?.choices?.[0]?.message?.content ?? JSON.stringify(result);
    }

    if (preferMimo && getMimoConfig().enabled) {
      const mimoResponse = await createMimoChatCompletion({
        model: model || process.env.MIMO_MODEL || MIMO_DEFAULT_MODEL,
        messages,
        stream,
        signal: requestSignal,
      });
      const result = await mimoResponse.json();
      return result?.choices?.[0]?.message?.content ?? JSON.stringify(result);
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

    return (
      result?.choices?.[0]?.message?.content ??
      result?.data?.content ??
      (typeof result === "string" ? result : JSON.stringify(result))
    );
  } catch (error) {
    throw normalizeModelRequestError(error, timeoutMs);
  }
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
