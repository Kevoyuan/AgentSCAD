import crypto from "node:crypto";

import type { ProviderConfig } from "@/lib/provider-settings";

const COOKIE_VERSION = 1;
const MAX_COOKIE_VALUE_BYTES = 3_700;

export const PROVIDER_COOKIE_NAME = process.env.NODE_ENV === "production"
  ? "__Host-agentscad-providers"
  : "agentscad-providers";

export class ProviderCookieError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ProviderCookieError";
    this.code = code;
  }
}

function encryptionKey(secret: string): Buffer {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new ProviderCookieError(
      "PROVIDER_SETTINGS_SECRET_INVALID",
      "Provider storage is not configured securely. PROVIDER_SETTINGS_SECRET must be at least 32 characters.",
    );
  }
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

export function sealProviderSettings(
  providers: ProviderConfig[],
  secret: string,
): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  cipher.setAAD(Buffer.from(`agentscad-provider-settings:v${COOKIE_VERSION}`));

  const plaintext = Buffer.from(
    JSON.stringify({ version: COOKIE_VERSION, providers }),
    "utf8",
  );
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const value = [
    COOKIE_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");

  if (Buffer.byteLength(value, "utf8") > MAX_COOKIE_VALUE_BYTES) {
    throw new ProviderCookieError(
      "PROVIDER_SETTINGS_TOO_LARGE",
      "Provider settings are too large for secure browser storage. Remove an unused provider or shorten its fields.",
    );
  }
  return value;
}

export function openProviderSettings(
  value: string | undefined,
  secret: string,
): ProviderConfig[] {
  if (!value) return [];

  try {
    const [version, ivValue, tagValue, encryptedValue, ...extra] = value.split(".");
    if (
      version !== String(COOKIE_VERSION) ||
      !ivValue ||
      !tagValue ||
      !encryptedValue ||
      extra.length > 0
    ) {
      return [];
    }

    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey(secret),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAAD(Buffer.from(`agentscad-provider-settings:v${COOKIE_VERSION}`));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(plaintext);
    return Array.isArray(parsed?.providers) ? parsed.providers : [];
  } catch {
    // Invalid, expired, or encrypted with a rotated key. Fail closed without
    // exposing cryptographic details or treating attacker input as plaintext.
    return [];
  }
}

export function readProviderCookie(
  cookieHeader: string | null | undefined,
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const segment of cookieHeader.split(";")) {
    const separator = segment.indexOf("=");
    if (separator === -1) continue;
    const name = segment.slice(0, separator).trim();
    if (name === PROVIDER_COOKIE_NAME) {
      return segment.slice(separator + 1).trim();
    }
  }
  return undefined;
}

export function serializeProviderCookie(value: string, clear = false): string {
  const attributes = [
    `${PROVIDER_COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (clear) attributes.push("Max-Age=0");
  if (process.env.NODE_ENV === "production") attributes.push("Secure");
  return attributes.join("; ");
}
