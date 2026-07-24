import type { NextRequest } from "next/server";

export const JOB_SESSION_COOKIE_NAME =
  process.env.NODE_ENV === "production"
    ? "__Host-agentscad-job-session"
    : "agentscad-job-session";

export const JOB_SESSION_HEADER = "x-agentscad-job-session";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type JobAccessScope =
  | { kind: "admin" }
  | { kind: "browser"; browserSessionId: string };

export function createJobSessionToken(): string {
  return crypto.randomUUID();
}

export function isValidJobSessionToken(value: string | null | undefined): value is string {
  return Boolean(value && UUID_PATTERN.test(value));
}

export function readJobSessionCookie(
  cookieHeader: string | null | undefined,
): string | undefined {
  if (!cookieHeader) return undefined;

  for (const segment of cookieHeader.split(";")) {
    const separator = segment.indexOf("=");
    if (separator === -1) continue;
    const name = segment.slice(0, separator).trim();
    if (name === JOB_SESSION_COOKIE_NAME) {
      const value = segment.slice(separator + 1).trim();
      return isValidJobSessionToken(value) ? value : undefined;
    }
  }

  return undefined;
}

async function hashJobSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`agentscad-job-session:v1:${token}`),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function getJobAccessScope(
  request: Pick<NextRequest, "headers"> | Request,
): Promise<JobAccessScope | null> {
  const apiSecret = process.env.API_SECRET;
  if (
    apiSecret &&
    request.headers.get("authorization") === `Bearer ${apiSecret}`
  ) {
    return { kind: "admin" };
  }

  const forwardedToken = request.headers.get(JOB_SESSION_HEADER);
  const token = isValidJobSessionToken(forwardedToken)
    ? forwardedToken
    : readJobSessionCookie(request.headers.get("cookie"));

  if (!token) return null;

  return {
    kind: "browser",
    browserSessionId: await hashJobSessionToken(token),
  };
}

export function jobAccessFilter(
  access: JobAccessScope,
): { browserSessionId?: string } {
  return access.kind === "browser"
    ? { browserSessionId: access.browserSessionId }
    : {};
}
