import { describe, expect, test } from "bun:test";

import {
  openProviderSettings,
  PROVIDER_COOKIE_NAME,
  readProviderCookie,
  sealProviderSettings,
  serializeProviderCookie,
} from "@/lib/provider-cookie-store";
import type { ProviderConfig } from "@/lib/provider-settings";

const SECRET = "test-only-provider-cookie-secret-that-is-long-enough";
const PROVIDER: ProviderConfig = {
  id: "provider-1",
  name: "OpenRouter",
  type: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "sk-or-v1-sensitive-test-value",
  defaultModel: "openai/gpt-5.6-sol",
  enabled: true,
  isDefault: true,
  createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z",
};

describe("encrypted provider session cookie", () => {
  test("round-trips provider settings without exposing plaintext", () => {
    const sealed = sealProviderSettings([PROVIDER], SECRET);

    expect(sealed).not.toContain(PROVIDER.apiKey!);
    expect(sealed).not.toContain(PROVIDER.name);
    expect(openProviderSettings(sealed, SECRET)).toEqual([PROVIDER]);
  });

  test("rejects tampering and key rotation without leaking details", () => {
    const sealed = sealProviderSettings([PROVIDER], SECRET);
    const tampered = `${sealed.slice(0, -1)}${sealed.endsWith("A") ? "B" : "A"}`;

    expect(openProviderSettings(tampered, SECRET)).toEqual([]);
    expect(openProviderSettings(
      sealed,
      "different-provider-cookie-secret-that-is-long-enough",
    )).toEqual([]);
  });

  test("treats absent and malformed cookie envelopes as empty settings", () => {
    expect(openProviderSettings(undefined, SECRET)).toEqual([]);
    expect(openProviderSettings("not.a.valid.cookie.envelope", SECRET)).toEqual([]);
    expect(openProviderSettings("1.bad.bad.bad", SECRET)).toEqual([]);
  });

  test("rejects insecure encryption secrets and oversized session payloads", () => {
    expect(() => sealProviderSettings([PROVIDER], "too-short")).toThrow(
      "at least 32 characters",
    );
    expect(() => sealProviderSettings([
      { ...PROVIDER, apiKey: "x".repeat(4_000) },
    ], SECRET)).toThrow("too large");
  });

  test("reads the provider value from a multi-cookie request header", () => {
    expect(readProviderCookie(
      `theme=dark; ${PROVIDER_COOKIE_NAME}=encrypted.value; locale=en`,
    )).toBe("encrypted.value");
    expect(readProviderCookie("theme=dark; locale=en")).toBeUndefined();
  });

  test("creates an HttpOnly strict session cookie without persistent expiry", () => {
    const header = serializeProviderCookie(sealProviderSettings([PROVIDER], SECRET));

    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Strict");
    expect(header).toContain("Path=/");
    expect(header).not.toContain("Max-Age=");
    expect(header).not.toContain("Expires=");
  });

  test("expires the cookie immediately when the user clears keys", () => {
    expect(serializeProviderCookie("", true)).toContain("Max-Age=0");
  });
});
