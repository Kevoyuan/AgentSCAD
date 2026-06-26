import { NextResponse } from "next/server";

import {
  deleteProviderSettings,
  getEnvProviderConfigs,
  readProviderSettings,
  toPublicProvider,
  upsertProviderSettings,
  type ProviderType,
} from "@/lib/provider-settings";
import { getProviderPreset } from "@/lib/provider-catalog";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function serverError(error: unknown, fallback: string) {
  console.error(fallback, error);
  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 500 },
  );
}

export async function GET() {
  try {
    const providers = await readProviderSettings();
    return NextResponse.json({
      providers: providers.map(toPublicProvider),
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

export async function POST(request: Request) {
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

    const provider = await upsertProviderSettings({
      id: typeof body.id === "string" ? body.id : undefined,
      name,
      type: (body.type as ProviderType) || "openai-compatible",
      baseUrl,
      apiKey,
      keepExistingApiKey,
      defaultModel,
      enabled: body.enabled !== false,
      isDefault: Boolean(body.isDefault),
    });

    return NextResponse.json({ provider: toPublicProvider(provider) });
  } catch (error) {
    return serverError(error, "Failed to save provider");
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return badRequest("Provider id is required");
    await deleteProviderSettings(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error, "Failed to delete provider");
  }
}
