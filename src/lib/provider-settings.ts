import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import type { MimoMessage } from "@/lib/mimo";
import { getProviderPresetByModel, PROVIDER_PRESETS } from "@/lib/provider-catalog";

export type ProviderType =
  | "openai-compatible"
  | "openai"
  | "openrouter"
  | "deepseek"
  | "mimo"
  | "ollama";

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
  enabled: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PublicProviderConfig = Omit<ProviderConfig, "apiKey"> & {
  hasApiKey: boolean;
  apiKeyPreview?: string;
};

const PROVIDER_SETTINGS_DIR = path.join(process.cwd(), ".agentscad");
const PROVIDER_SETTINGS_PATH = path.join(PROVIDER_SETTINGS_DIR, "providers.json");

function maskApiKey(apiKey?: string) {
  if (!apiKey) return undefined;
  if (apiKey.length <= 8) return "••••";
  return `${apiKey.slice(0, 4)}••••${apiKey.slice(-4)}`;
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/$/, "");
}

function modelSettingId(providerId: string, model: string) {
  return `provider:${providerId}:${model}`;
}

export function parseProviderModelId(model?: string) {
  if (!model?.startsWith("provider:")) return null;
  const [, providerId, ...modelParts] = model.split(":");
  const providerModel = modelParts.join(":").trim();
  if (!providerId || !providerModel) return null;
  return { providerId, model: providerModel };
}

export function toProviderModelId(provider: Pick<ProviderConfig, "id" | "defaultModel">) {
  return modelSettingId(provider.id, provider.defaultModel);
}

export function toPublicProvider(provider: ProviderConfig): PublicProviderConfig {
  const { apiKey, ...rest } = provider;
  return {
    ...rest,
    hasApiKey: Boolean(apiKey),
    apiKeyPreview: maskApiKey(apiKey),
  };
}

export async function readProviderSettings(): Promise<ProviderConfig[]> {
  try {
    const raw = await fs.readFile(PROVIDER_SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.providers)) return [];
    return parsed.providers
      .filter((provider: Partial<ProviderConfig>) => provider.id && provider.name && provider.baseUrl && provider.defaultModel)
      .map((provider: ProviderConfig) => ({
        ...provider,
        baseUrl: normalizeBaseUrl(provider.baseUrl),
        enabled: provider.enabled !== false,
        isDefault: Boolean(provider.isDefault),
      }));
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
}

async function writeProviderSettings(providers: ProviderConfig[]) {
  await fs.mkdir(PROVIDER_SETTINGS_DIR, { recursive: true });
  await fs.writeFile(
    PROVIDER_SETTINGS_PATH,
    `${JSON.stringify({ providers }, null, 2)}\n`,
    "utf8"
  );
}

export async function upsertProviderSettings(input: {
  id?: string;
  name: string;
  type?: ProviderType;
  baseUrl: string;
  apiKey?: string;
  keepExistingApiKey?: boolean;
  defaultModel: string;
  enabled?: boolean;
  isDefault?: boolean;
}) {
  const providers = await readProviderSettings();
  const now = new Date().toISOString();
  const existing = input.id ? providers.find((provider) => provider.id === input.id) : undefined;
  const id = existing?.id || crypto.randomUUID();
  const nextProvider: ProviderConfig = {
    id,
    name: input.name.trim(),
    type: input.type || existing?.type || "openai-compatible",
    baseUrl: normalizeBaseUrl(input.baseUrl),
    apiKey: input.keepExistingApiKey ? existing?.apiKey : input.apiKey?.trim() || undefined,
    defaultModel: input.defaultModel.trim(),
    enabled: input.enabled ?? existing?.enabled ?? true,
    isDefault: input.isDefault ?? existing?.isDefault ?? providers.length === 0,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  const nextProviders = providers.map((provider) =>
    provider.id === id ? nextProvider : provider
  );
  if (!existing) nextProviders.push(nextProvider);

  const normalized = nextProvider.isDefault
    ? nextProviders.map((provider) => ({ ...provider, isDefault: provider.id === id }))
    : nextProviders;

  await writeProviderSettings(normalized);
  return nextProvider;
}

export async function deleteProviderSettings(id: string) {
  const providers = await readProviderSettings();
  const remaining = providers.filter((provider) => provider.id !== id);
  if (!remaining.some((provider) => provider.isDefault) && remaining[0]) {
    remaining[0] = { ...remaining[0], isDefault: true };
  }
  await writeProviderSettings(remaining);
}

export async function findProviderForModel(model?: string) {
  const providers = await readProviderSettings();
  const parsed = parseProviderModelId(model);
  if (parsed) {
    const provider = providers.find((item) => item.id === parsed.providerId && item.enabled);
    if (provider) return { provider, model: parsed.model };

    const envProvider = findEnvProviderForModelId(parsed.providerId, parsed.model);
    return envProvider;
  }

  const exact = providers.find((provider) => provider.enabled && provider.defaultModel === model);
  if (exact) return { provider: exact, model: exact.defaultModel };

  const envProvider = findEnvProviderForModel(model);
  if (envProvider) return envProvider;

  if (model) return null;

  const defaultProvider = providers.find((provider) => provider.enabled && provider.isDefault);
  if (defaultProvider) {
    return { provider: defaultProvider, model: model || defaultProvider.defaultModel };
  }

  return null;
}

export function getEnvProviderConfigs(): PublicProviderConfig[] {
  const now = new Date(0).toISOString();
  return PROVIDER_PRESETS
    .filter((preset) => preset.apiKeyEnv || !preset.requiresApiKey)
    .map((preset) => {
      const apiKey = preset.apiKeyEnv ? process.env[preset.apiKeyEnv]?.trim() : undefined;
      const enabled = preset.requiresApiKey ? Boolean(apiKey) : true;
      return toPublicProvider({
        id: `env-${preset.id}`,
        name: preset.label,
        type: preset.type,
        baseUrl: preset.baseUrl,
        apiKey,
        defaultModel: preset.defaultModel,
        enabled,
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      });
    });
}

function findEnvProviderForModel(model?: string) {
  const preset = getProviderPresetByModel(model);
  if (!preset) return null;
  const apiKey = preset.apiKeyEnv ? process.env[preset.apiKeyEnv]?.trim() : undefined;
  if (preset.requiresApiKey && !apiKey) return null;

  const now = new Date(0).toISOString();
  return {
    provider: {
      id: `env-${preset.id}`,
      name: preset.label,
      type: preset.type,
      baseUrl: preset.baseUrl,
      apiKey,
      defaultModel: preset.defaultModel,
      enabled: true,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    },
    model: model || preset.defaultModel,
  };
}

function findEnvProviderForModelId(providerId: string, model: string) {
  const presetId = providerId.replace(/^env-/, "");
  const preset = PROVIDER_PRESETS.find((item) => item.id === presetId);
  if (!preset) return null;

  const apiKey = preset.apiKeyEnv ? process.env[preset.apiKeyEnv]?.trim() : undefined;
  if (preset.requiresApiKey && !apiKey) return null;

  const now = new Date(0).toISOString();
  return {
    provider: {
      id: `env-${preset.id}`,
      name: preset.label,
      type: preset.type,
      baseUrl: preset.baseUrl,
      apiKey,
      defaultModel: preset.defaultModel,
      enabled: true,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    },
    model: model || preset.defaultModel,
  };
}

export async function createProviderChatCompletion(args: {
  provider: ProviderConfig;
  model?: string;
  messages: MimoMessage[];
  stream?: boolean;
}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (args.provider.apiKey) {
    headers.Authorization = `Bearer ${args.provider.apiKey}`;
  }
  if (args.provider.type === "openrouter") {
    const referer = process.env.OPENROUTER_HTTP_REFERER?.trim();
    headers["X-Title"] = process.env.OPENROUTER_APP_TITLE?.trim() || "AgentSCAD";
    if (referer) headers["HTTP-Referer"] = referer;
  }

  const response = await fetch(`${args.provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: args.model || args.provider.defaultModel,
      messages: args.messages,
      stream: args.stream ?? false,
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`${args.provider.name} request failed (${response.status}): ${bodyText}`);
  }

  return response;
}

export async function testProviderConnection(args: {
  provider: Pick<ProviderConfig, "name" | "baseUrl" | "apiKey" | "defaultModel">;
}) {
  const response = await createProviderChatCompletion({
    provider: {
      id: "test",
      type: "openai-compatible",
      enabled: true,
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      name: args.provider.name,
      baseUrl: normalizeBaseUrl(args.provider.baseUrl),
      apiKey: args.provider.apiKey?.trim() || undefined,
      defaultModel: args.provider.defaultModel,
    },
    model: args.provider.defaultModel,
    messages: [{ role: "user", content: "Reply with OK." }],
  });
  const result = await response.json();
  return result?.choices?.[0]?.message?.content ?? "OK";
}
