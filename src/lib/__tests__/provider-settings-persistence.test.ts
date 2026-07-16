import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";

import {
  getProviderSettingsPersistence,
  ProviderSettingsReadOnlyError,
  upsertProviderSettings,
} from "@/lib/provider-settings";
import { DELETE, GET, POST } from "@/app/api/providers/route";
import { POST as TEST_PROVIDER } from "@/app/api/providers/test/route";

const originalVercel = process.env.VERCEL;
const originalProviderSettingsSecret = process.env.PROVIDER_SETTINGS_SECRET;
const originalApiSecret = process.env.API_SECRET;

describe("provider settings persistence", () => {
  beforeEach(() => {
    delete process.env.VERCEL;
    delete process.env.PROVIDER_SETTINGS_SECRET;
    delete process.env.API_SECRET;
  });

  afterEach(() => {
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
    if (originalProviderSettingsSecret === undefined) {
      delete process.env.PROVIDER_SETTINGS_SECRET;
    } else {
      process.env.PROVIDER_SETTINGS_SECRET = originalProviderSettingsSecret;
    }
    if (originalApiSecret === undefined) delete process.env.API_SECRET;
    else process.env.API_SECRET = originalApiSecret;
  });

  test("uses environment-managed providers on Vercel", () => {
    process.env.VERCEL = "1";

    expect(getProviderSettingsPersistence()).toEqual({
      mode: "environment",
      writable: false,
    });
  });

  test("uses writable file persistence outside Vercel", () => {
    expect(getProviderSettingsPersistence()).toEqual({
      mode: "file",
      writable: true,
    });
  });

  test("uses encrypted session persistence on Vercel when configured", () => {
    process.env.VERCEL = "1";
    process.env.PROVIDER_SETTINGS_SECRET = "a-secure-provider-settings-secret-with-32-chars";

    expect(getProviderSettingsPersistence()).toEqual({
      mode: "encrypted-cookie",
      writable: true,
    });
  });

  test("saves, reloads, and clears an encrypted provider session", async () => {
    process.env.VERCEL = "1";
    process.env.PROVIDER_SETTINGS_SECRET = "a-secure-provider-settings-secret-with-32-chars";

    const saveResponse = await POST(
      new NextRequest("https://agentscad.test/api/providers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://agentscad.test",
        },
        body: JSON.stringify({
          preset: "openrouter",
          name: "OpenRouter",
          type: "openrouter",
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey: "session-only-sensitive-key",
          defaultModel: "openai/gpt-5.6-sol",
        }),
      }),
    );
    const saveBody = await saveResponse.json();
    const setCookie = saveResponse.headers.get("set-cookie");

    expect(saveResponse.status).toBe(200);
    expect(saveBody.provider.hasApiKey).toBe(true);
    expect(JSON.stringify(saveBody)).not.toContain("session-only-sensitive-key");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).not.toContain("session-only-sensitive-key");

    let cookie = setCookie!.split(";")[0];
    const getResponse = await GET(
      new NextRequest("https://agentscad.test/api/providers", {
        headers: {
          Cookie: cookie,
          Origin: "https://agentscad.test",
        },
      }),
    );
    const getBody = await getResponse.json();

    expect(getBody.providers).toHaveLength(1);
    expect(getBody.providers[0].name).toBe("OpenRouter");
    expect(JSON.stringify(getBody)).not.toContain("session-only-sensitive-key");

    const updateResponse = await POST(
      new NextRequest("https://agentscad.test/api/providers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          Origin: "https://agentscad.test",
        },
        body: JSON.stringify({
          id: getBody.providers[0].id,
          preset: "openrouter",
          name: "OpenRouter",
          type: "openrouter",
          baseUrl: "https://openrouter.ai/api/v1",
          keepExistingApiKey: true,
          defaultModel: "anthropic/claude-sonnet-5",
        }),
      }),
    );
    const updateBody = await updateResponse.json();
    expect(updateResponse.status).toBe(200);
    expect(updateBody.provider.hasApiKey).toBe(true);
    expect(updateBody.provider.defaultModel).toBe("anthropic/claude-sonnet-5");
    cookie = updateResponse.headers.get("set-cookie")!.split(";")[0];

    const clearResponse = await DELETE(
      new NextRequest("https://agentscad.test/api/providers?all=true", {
        method: "DELETE",
        headers: {
          Cookie: cookie,
          Origin: "https://agentscad.test",
        },
      }),
    );
    expect(clearResponse.status).toBe(200);
    expect(clearResponse.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  test("enforces route-level authorization independently of middleware", async () => {
    process.env.API_SECRET = "route-level-test-secret";

    const denied = await GET(
      new NextRequest("https://agentscad.test/api/providers"),
    );
    const allowed = await GET(
      new NextRequest("https://agentscad.test/api/providers", {
        headers: { Authorization: "Bearer route-level-test-secret" },
      }),
    );

    expect(denied.status).toBe(401);
    expect(allowed.status).toBe(200);
  });

  test("maps invalid provider input and blocked test URLs to safe 400 responses", async () => {
    process.env.VERCEL = "1";
    process.env.PROVIDER_SETTINGS_SECRET = "a-secure-provider-settings-secret-with-32-chars";

    const missingFields = await POST(
      new NextRequest("https://agentscad.test/api/providers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://agentscad.test",
        },
        body: JSON.stringify({ name: "Incomplete" }),
      }),
    );
    const blockedTarget = await TEST_PROVIDER(
      new NextRequest("https://agentscad.test/api/providers/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://agentscad.test",
        },
        body: JSON.stringify({
          name: "Internal",
          baseUrl: "http://169.254.169.254/latest",
          defaultModel: "metadata",
        }),
      }),
    );
    const blockedBody = await blockedTarget.json();

    expect(missingFields.status).toBe(400);
    expect(blockedTarget.status).toBe(400);
    expect(blockedBody.error).toContain("HTTPS");
    expect(JSON.stringify(blockedBody)).not.toContain("169.254.169.254");
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

    const response = await GET(
      new NextRequest("https://agentscad.test/api/providers"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.persistence).toEqual({
      mode: "environment",
      writable: false,
    });
  });

  test("returns an actionable conflict instead of a filesystem 500", async () => {
    process.env.VERCEL = "1";
    const request = new NextRequest("https://agentscad.test/api/providers", {
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

  test("rejects deletes on Vercel with the same actionable conflict", async () => {
    process.env.VERCEL = "1";

    const response = await DELETE(
      new NextRequest("https://agentscad.test/api/providers?id=provider-1", {
        method: "DELETE",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("PROVIDER_SETTINGS_READ_ONLY");
  });

});
