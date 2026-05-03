import type { MimoMessage } from "@/lib/mimo";
import { fetchWithRetry } from "@/lib/utils/fetch-with-retry";

const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-5.5";

export function getOpenRouterConfig() {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const baseUrl = (process.env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_BASE_URL).replace(/\/$/, "");
  const defaultModel = process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
  const referer = process.env.OPENROUTER_HTTP_REFERER?.trim();
  const title = process.env.OPENROUTER_APP_TITLE?.trim() || "AgentSCAD";

  return {
    apiKey,
    baseUrl,
    defaultModel,
    referer,
    title,
    enabled: Boolean(apiKey),
  };
}

export function isOpenRouterModel(model?: string) {
  const requestedModel = model?.trim();

  if (!requestedModel) {
    return false;
  }

  return requestedModel === getOpenRouterConfig().defaultModel || requestedModel.includes("/");
}

export async function createOpenRouterChatCompletion(args: {
  messages: MimoMessage[];
  model?: string;
  stream?: boolean;
}) {
  const { apiKey, baseUrl, defaultModel, enabled, referer, title } = getOpenRouterConfig();

  if (!enabled || !apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "X-Title": title,
  };

  if (referer) {
    headers["HTTP-Referer"] = referer;
  }

  const response = await fetchWithRetry(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: args.model || defaultModel,
      messages: args.messages,
      stream: args.stream ?? false,
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`OpenRouter API request failed (${response.status}): ${bodyText}`);
  }

  return response;
}

export const OPENROUTER_DEFAULT_MODEL = DEFAULT_OPENROUTER_MODEL;
