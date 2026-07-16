import { NextRequest, NextResponse } from "next/server";

import { authorizeApiRequest } from "@/lib/auth";
import {
  ProviderValidationError,
  readProviderSettings,
  testProviderConnection,
} from "@/lib/provider-settings";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: NextRequest) {
  if (!authorizeApiRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid JSON body");

  const providers = await readProviderSettings(request.headers.get("cookie"));
  const existing = typeof body.id === "string"
    ? providers.find((provider) => provider.id === body.id)
    : undefined;

  const name = String(body.name || existing?.name || "").trim();
  const baseUrl = String(body.baseUrl || existing?.baseUrl || "").trim();
  const defaultModel = String(body.defaultModel || existing?.defaultModel || "").trim();
  const apiKey = typeof body.apiKey === "string" && body.apiKey.trim()
    ? body.apiKey
    : existing?.apiKey;

  if (!name) return badRequest("Provider name is required");
  if (!baseUrl) return badRequest("Base URL is required");
  if (!defaultModel) return badRequest("Default model is required");

  try {
    const content = await testProviderConnection({
      provider: { name, baseUrl, apiKey, defaultModel },
    });
    return NextResponse.json({ ok: true, content });
  } catch (error) {
    if (error instanceof ProviderValidationError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Connection test failed" },
      { status: 502 }
    );
  }
}
