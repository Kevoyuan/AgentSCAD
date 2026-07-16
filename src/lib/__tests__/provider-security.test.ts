import { afterEach, describe, expect, test } from "bun:test";

import {
  createProviderChatCompletion,
  validateProviderBaseUrl,
  type ProviderConfig,
} from "@/lib/provider-settings";

const originalVercel = process.env.VERCEL;
const originalAllowlist = process.env.PROVIDER_BASE_URL_ALLOWLIST;
const originalFetch = globalThis.fetch;

afterEach(() => {
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
  if (originalAllowlist === undefined) delete process.env.PROVIDER_BASE_URL_ALLOWLIST;
  else process.env.PROVIDER_BASE_URL_ALLOWLIST = originalAllowlist;
  globalThis.fetch = originalFetch;
});

describe("provider outbound URL policy", () => {
  test("allows catalog providers in production", () => {
    process.env.VERCEL = "1";
    expect(validateProviderBaseUrl("https://openrouter.ai/api/v1/")).toBe(
      "https://openrouter.ai/api/v1",
    );
  });

  test("blocks arbitrary, private, credentialed, and insecure production URLs", () => {
    process.env.VERCEL = "1";

    expect(() => validateProviderBaseUrl("https://127.0.0.1/v1")).toThrow(
      "not allowed",
    );
    expect(() => validateProviderBaseUrl("http://169.254.169.254/latest")).toThrow(
      "HTTPS",
    );
    const credentialedUrl = ["https://user", "pass@example.com/v1"].join(":");
    expect(() => validateProviderBaseUrl(credentialedUrl)).toThrow(
      "credentials",
    );
    expect(() => validateProviderBaseUrl("file:///etc/passwd")).toThrow("HTTPS");
  });

  test("allows an exact trusted custom HTTPS URL configured by operators", () => {
    process.env.VERCEL = "1";
    process.env.PROVIDER_BASE_URL_ALLOWLIST = "https://llm.example.test/v1";

    expect(validateProviderBaseUrl("https://llm.example.test/v1")).toBe(
      "https://llm.example.test/v1",
    );
    expect(() => validateProviderBaseUrl("https://llm.example.test/other")).toThrow(
      "not allowed",
    );
  });

  test("does not expose an upstream error body and refuses redirects", async () => {
    process.env.VERCEL = "1";
    let redirectMode: RequestRedirect | undefined;
    globalThis.fetch = Object.assign(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        redirectMode = init?.redirect;
        return new Response("internal-provider-secret-response", { status: 401 });
      },
      { preconnect: originalFetch.preconnect },
    ) as typeof fetch;
    const provider: ProviderConfig = {
      id: "provider-1",
      name: "OpenRouter",
      type: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "test-key",
      defaultModel: "openai/gpt-5.6-sol",
      enabled: true,
      isDefault: true,
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    };

    try {
      await createProviderChatCompletion({
        provider,
        messages: [{ role: "user", content: "test" }],
      });
      throw new Error("Expected provider request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(
        "internal-provider-secret-response",
      );
      expect((error as Error).message).toContain("request failed (401)");
    }
    expect(redirectMode).toBe("error");
  });
});
