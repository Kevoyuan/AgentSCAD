import { fetchWithRetry } from "@/lib/utils/fetch-with-retry";

const DEFAULT_MIMO_BASE_URL = "https://token-plan-cn.xiaomimimo.com/v1";
const DEFAULT_MIMO_MODEL = "mimo-v2.5-pro";

export type MimoContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type MimoMessage = {
  role: string;
  content: string | MimoContentPart[];
};

export function getMimoConfig() {
  const apiKey = process.env.MIMO_API_KEY?.trim();
  const baseUrl = (process.env.MIMO_BASE_URL || DEFAULT_MIMO_BASE_URL).replace(/\/$/, "");
  const defaultModel = process.env.MIMO_MODEL?.trim() || DEFAULT_MIMO_MODEL;

  return {
    apiKey,
    baseUrl,
    defaultModel,
    enabled: Boolean(apiKey),
  };
}

export async function createMimoChatCompletion(args: {
  messages: MimoMessage[];
  model?: string;
  stream?: boolean;
}) {
  const { apiKey, baseUrl, defaultModel, enabled } = getMimoConfig();

  if (!enabled || !apiKey) {
    throw new Error("MIMO_API_KEY is not configured");
  }

  const response = await fetchWithRetry(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: args.model || defaultModel,
      messages: args.messages,
      stream: args.stream ?? false,
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`MiMo API request failed (${response.status}): ${bodyText}`);
  }

  return response;
}

export const MIMO_DEFAULT_MODEL = DEFAULT_MIMO_MODEL;
