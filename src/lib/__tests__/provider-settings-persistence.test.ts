import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  getProviderSettingsPersistence,
  ProviderSettingsReadOnlyError,
  upsertProviderSettings,
} from "@/lib/provider-settings";
import { GET, POST } from "@/app/api/providers/route";

const originalVercel = process.env.VERCEL;

describe("provider settings persistence", () => {
  beforeEach(() => {
    delete process.env.VERCEL;
  });

  afterEach(() => {
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;

  });

  test("uses environment-managed providers on Vercel", () => {
    process.env.VERCEL = "1";

    expect(getProviderSettingsPersistence()).toEqual({
      mode: "environment",
      writable: false,
    });
  });

  test("rejects Vercel writes before touching the read-only filesystem", async () => {
    process.env.VERCEL = "1";

    await expect(
      upsertProviderSettings({
        name: "OpenRouter",
        type: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "not-a-real-key",
        defaultModel: "openai/gpt-5.6",
      })
    ).rejects.toBeInstanceOf(ProviderSettingsReadOnlyError);
  });

  test("reports environment-only persistence through the providers API", async () => {
    process.env.VERCEL = "1";

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.persistence).toEqual({
      mode: "environment",
      writable: false,
    });
  });

  test("returns an actionable conflict instead of a filesystem 500", async () => {
    process.env.VERCEL = "1";
    const request = new Request("https://agentscad.test/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preset: "openrouter",
        name: "OpenRouter",
        type: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "not-a-real-key",
        defaultModel: "openai/gpt-5.6",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("PROVIDER_SETTINGS_READ_ONLY");
    expect(body.error).toContain("Vercel Project Settings");
  });

});
