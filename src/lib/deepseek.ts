import type { MimoMessage } from "@/lib/mimo";
import { fetchWithRetry } from "@/lib/utils/fetch-with-retry";

const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-pro";

export function getDeepSeekConfig() {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL).replace(/\/$/, "");
  const defaultModel = process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL;

  return {
    apiKey,
    baseUrl,
    defaultModel,
    enabled: Boolean(apiKey),
  };
}

export async function createDeepSeekChatCompletion(args: {
  messages: MimoMessage[];
  model?: string;
  stream?: boolean;
}) {
  const { apiKey, baseUrl, defaultModel, enabled } = getDeepSeekConfig();

  if (!enabled || !apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not configured");
  }

  const model = args.model || defaultModel;
  const body: Record<string, unknown> = {
    model,
    messages: args.messages,
    stream: args.stream ?? false,
  };

  if (model === "deepseek-v4-pro" || model === "deepseek-v4-flash") {
    body.thinking = { type: "enabled" };
    body.reasoning_effort = "high";
  }

  const response = await fetchWithRetry(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`DeepSeek API request failed (${response.status}): ${bodyText}`);
  }

  return response;
}

export const DEEPSEEK_DEFAULT_MODEL = DEFAULT_DEEPSEEK_MODEL;
