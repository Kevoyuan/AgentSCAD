import { NextRequest, NextResponse } from "next/server";

import { authorizeApiRequest } from "@/lib/auth";
import {
  deleteProviderSettings,
  getEnvProviderConfigs,
  getProviderSettingsPersistence,
  ProviderSettingsReadOnlyError,
  ProviderValidationError,
  readProviderSettings,
  toPublicProvider,
  upsertProviderSettings,
  type ProviderType,
} from "@/lib/provider-settings";
import { getProviderPreset } from "@/lib/provider-catalog";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function serverError(error: unknown, fallback: string) {
  if (error instanceof ProviderSettingsReadOnlyError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: 409 },
    );
  }
  if (error instanceof ProviderValidationError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: 400 },
    );
  }
  console.error(fallback, error);
  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 500 },
  );
}

function withProviderCookie(response: NextResponse, setCookieHeader?: string) {
  if (setCookieHeader) response.headers.set("Set-Cookie", setCookieHeader);
  return response;
}

export async function GET(request: NextRequest) {
  if (!authorizeApiRequest(request)) return unauthorized();
  try {
    const providers = await readProviderSettings(request.headers.get("cookie"));
    return NextResponse.json({
      providers: providers.map(toPublicProvider),
      persistence: getProviderSettingsPersistence(),
      envProviders: getEnvProviderConfigs().map((provider) => ({
        id: provider.id,
        name: provider.name,
        enabled: provider.enabled,
        envKey: getProviderPreset(provider.id.replace(/^env-/, ""))?.apiKeyEnv || "No key required",
      })),
    });
  } catch (error) {
    return serverError(error, "Failed to fetch providers");
  }
}

export async function POST(request: NextRequest) {
  if (!authorizeApiRequest(request)) return unauthorized();
  try {
    const body = await request.json().catch(() => null);
    if (!body) return badRequest("Invalid JSON body");

    const name = String(body.name || "").trim();
    const baseUrl = String(body.baseUrl || "").trim();
    const defaultModel = String(body.defaultModel || "").trim();
    const apiKey = typeof body.apiKey === "string" ? body.apiKey : undefined;
    const keepExistingApiKey = Boolean(body.keepExistingApiKey);

    if (!name) return badRequest("Provider name is required");
    if (!baseUrl) return badRequest("Base URL is required");
    if (!defaultModel) return badRequest("Default model is required");
    const preset = typeof body.preset === "string" ? getProviderPreset(body.preset) : undefined;
    const requiresApiKey = preset?.requiresApiKey ?? body.type !== "ollama";
    if (!apiKey?.trim() && !keepExistingApiKey && requiresApiKey) {
      return badRequest("API key is required");
    }

    const result = await upsertProviderSettings({
      id: typeof body.id === "string" ? body.id : undefined,
      name,
      type: (body.type as ProviderType) || "openai-compatible",
      baseUrl,
      apiKey,
      keepExistingApiKey,
      defaultModel,
      enabled: body.enabled !== false,
      isDefault: Boolean(body.isDefault),
    }, request.headers.get("cookie"));

    return withProviderCookie(
      NextResponse.json({ provider: toPublicProvider(result.provider) }),
      result.setCookieHeader,
    );
  } catch (error) {
    return serverError(error, "Failed to save provider");
  }
}

export async function DELETE(request: NextRequest) {
  if (!authorizeApiRequest(request)) return unauthorized();
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const deleteAll = searchParams.get("all") === "true";
    if (!id && !deleteAll) return badRequest("Provider id is required");
    const result = deleteAll
      ? await deleteProviderSettings("", request.headers.get("cookie"), true)
      : await deleteProviderSettings(id || "", request.headers.get("cookie"));
    return withProviderCookie(
      NextResponse.json({ ok: true }),
      result.setCookieHeader,
    );
  } catch (error) {
    return serverError(error, "Failed to delete provider");
  }
}
