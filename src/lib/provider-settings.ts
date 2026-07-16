import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { cookies } from "next/headers";

import type { MimoMessage } from "@/lib/mimo";
import { getProviderPresetByModel, PROVIDER_PRESETS } from "@/lib/provider-catalog";
import {
  openProviderSettings,
  PROVIDER_COOKIE_NAME,
  readProviderCookie,
  sealProviderSettings,
  serializeProviderCookie,
} from "@/lib/provider-cookie-store";

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

export interface ProviderSettingsPersistence {
  mode: "file" | "environment" | "encrypted-cookie";
  writable: boolean;
}

const MAX_SAVED_PROVIDERS = 5;

export class ProviderSettingsReadOnlyError extends Error {
  readonly code = "PROVIDER_SETTINGS_READ_ONLY";

  constructor() {
    super(
      "Custom provider settings cannot be saved on Vercel. Add the provider API key in Vercel Project Settings → Environment Variables, then redeploy. Connection tests remain available, but keys entered here are not stored."
    );
    this.name = "ProviderSettingsReadOnlyError";
  }
}

export class ProviderValidationError extends Error {
  readonly code = "PROVIDER_VALIDATION_FAILED";

  constructor(message: string) {
    super(message);
    this.name = "ProviderValidationError";
  }
}

export function getProviderSettingsPersistence(): ProviderSettingsPersistence {
  if (process.env.VERCEL) {
    if ((process.env.PROVIDER_SETTINGS_SECRET?.trim().length || 0) >= 32) {
      return { mode: "encrypted-cookie", writable: true };
    }
    return { mode: "environment", writable: false };
  }
  return { mode: "file", writable: true };
}

const PROVIDER_SETTINGS_DIR = path.join(process.cwd(), ".agentscad");
const PROVIDER_SETTINGS_PATH = path.join(PROVIDER_SETTINGS_DIR, "providers.json");

function maskApiKey(apiKey?: string) {
  if (!apiKey) return undefined;
  return "••••••••";
}

export function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, "");
}

function configuredProviderBaseUrls(): Set<string> {
  const catalogUrls = PROVIDER_PRESETS
    .filter((preset) => preset.category !== "local" && preset.category !== "custom")
    .map((preset) => normalizeBaseUrl(preset.baseUrl));
  const extraUrls = (process.env.PROVIDER_BASE_URL_ALLOWLIST || "")
    .split(",")
    .map(normalizeBaseUrl)
    .filter(Boolean);
  return new Set([...catalogUrls, ...extraUrls]);
}

export function validateProviderBaseUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new ProviderValidationError("Base URL must be a valid absolute URL");
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ProviderValidationError(
      "Base URL cannot contain credentials, query parameters, or fragments",
    );
  }

  const isProduction = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
  if (isProduction) {
    if (parsed.protocol !== "https:") {
      throw new ProviderValidationError("Production provider URLs must use HTTPS");
    }
    if (!configuredProviderBaseUrls().has(normalized)) {
      throw new ProviderValidationError(
        "This provider URL is not allowed in production. Choose a preset or add the exact HTTPS URL to PROVIDER_BASE_URL_ALLOWLIST.",
      );
    }
  } else if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new ProviderValidationError("Provider URL must use HTTP or HTTPS");
  }

  return normalized;
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

async function requestCookieHeader(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const value = cookieStore.get(PROVIDER_COOKIE_NAME)?.value;
    return value ? `${PROVIDER_COOKIE_NAME}=${value}` : null;
  } catch {
    return null;
  }
}

function normalizeStoredProviders(value: unknown): ProviderConfig[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((provider: Partial<ProviderConfig>) =>
      provider.id && provider.name && provider.baseUrl && provider.defaultModel
    )
    .slice(0, MAX_SAVED_PROVIDERS)
    .map((provider: ProviderConfig) => ({
      ...provider,
      baseUrl: normalizeBaseUrl(provider.baseUrl),
      enabled: provider.enabled !== false,
      isDefault: Boolean(provider.isDefault),
    }));
}

export async function readProviderSettings(
  cookieHeader?: string | null,
): Promise<ProviderConfig[]> {
  try {
    const persistence = getProviderSettingsPersistence();
    if (!persistence.writable) return [];
    if (persistence.mode === "encrypted-cookie") {
      const header = cookieHeader === undefined
        ? await requestCookieHeader()
        : cookieHeader;
      const providers = openProviderSettings(
        readProviderCookie(header),
        process.env.PROVIDER_SETTINGS_SECRET || "",
      );
      return normalizeStoredProviders(providers);
    }

    const raw = await fs.readFile(PROVIDER_SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeStoredProviders(parsed?.providers);
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
}

async function writeProviderSettings(providers: ProviderConfig[]) {
  const persistence = getProviderSettingsPersistence();
  if (!persistence.writable) {
    throw new ProviderSettingsReadOnlyError();
  }
  if (providers.length > MAX_SAVED_PROVIDERS) {
    throw new Error(`You can save up to ${MAX_SAVED_PROVIDERS} providers in this browser`);
  }
  if (persistence.mode === "encrypted-cookie") {
    if (providers.length === 0) {
      return serializeProviderCookie("", true);
    }
    const value = sealProviderSettings(
      providers,
      process.env.PROVIDER_SETTINGS_SECRET || "",
    );
    return serializeProviderCookie(value);
  }

  await fs.mkdir(PROVIDER_SETTINGS_DIR, { recursive: true });
  await fs.writeFile(
    PROVIDER_SETTINGS_PATH,
    `${JSON.stringify({ providers }, null, 2)}\n`,
    "utf8"
  );
  return undefined;
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
}, cookieHeader?: string | null) {
  const providers = await readProviderSettings(cookieHeader);
  const now = new Date().toISOString();
  const existing = input.id ? providers.find((provider) => provider.id === input.id) : undefined;
  const id = existing?.id || crypto.randomUUID();
  const nextProvider: ProviderConfig = {
    id,
    name: input.name.trim(),
    type: input.type || existing?.type || "openai-compatible",
    baseUrl: validateProviderBaseUrl(input.baseUrl),
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

  const setCookieHeader = await writeProviderSettings(normalized);
  return { provider: nextProvider, setCookieHeader };
}

export async function deleteProviderSettings(
  id: string,
  cookieHeader?: string | null,
  deleteAll = false,
) {
  const providers = await readProviderSettings(cookieHeader);
  const remaining = deleteAll
    ? []
    : providers.filter((provider) => provider.id !== id);
  if (!remaining.some((provider) => provider.isDefault) && remaining[0]) {
    remaining[0] = { ...remaining[0], isDefault: true };
  }
  const setCookieHeader = await writeProviderSettings(remaining);
  return { setCookieHeader };
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
    // Keyless local presets are not necessarily running. They become active
    // only after the user explicitly adds them in Provider Settings.
    .filter((preset) => preset.category !== "local" && Boolean(preset.apiKeyEnv))
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
  const baseUrl = validateProviderBaseUrl(args.provider.baseUrl);
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

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      model: args.model || args.provider.defaultModel,
      messages: args.messages,
      stream: args.stream ?? false,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `${args.provider.name} request failed (${response.status}). Check the key, model, and provider account.`,
    );
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
      baseUrl: validateProviderBaseUrl(args.provider.baseUrl),
      apiKey: args.provider.apiKey?.trim() || undefined,
      defaultModel: args.provider.defaultModel,
    },
    model: args.provider.defaultModel,
    messages: [{ role: "user", content: "Reply with OK." }],
  });
  const result = await response.json();
  return result?.choices?.[0]?.message?.content ?? "OK";
}
