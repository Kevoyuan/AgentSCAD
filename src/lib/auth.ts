import { NextRequest } from "next/server";

/**
 * Shared authentication helper used by both middleware and individual route
 * handlers (e.g. /api/cron).
 *
 * Checks the Authorization: Bearer header against a configured secret.
 * When no secret is configured, behaviour depends on the environment:
 *   - Development: allow all (convenience)
 *   - Production:  deny all (fail closed — the secret is mandatory)
 */

export function authenticateBearer(
  request: NextRequest,
  secret: string | undefined,
): boolean {
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return false;
    }
    return true;
  }

  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

/**
 * Returns true when the request most likely originates from the same
 * frontend application — evaluated from the Origin / Referer headers.
 *
 * This is a *defence-in-depth* check, not a cryptographic guarantee,
 * because both headers are spoofable by a determined attacker.  It is
 * useful as a lightweight gate for local / single-user tools where the
 * primary goal is preventing casual drive-by API access.
 */
export function isSameOriginRequest(request: NextRequest): boolean {
  const host = request.headers.get("host") || "";
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  const hostVariants = [host, ...(host.startsWith("localhost") ? ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"] : [])];

  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (hostVariants.some((h) => h === originHost)) return true;
    } catch {
      // Malformed origin — reject
    }
  }

  if (referer) {
    try {
      const refererUrl = new URL(referer);
      if (hostVariants.some((h) => h === refererUrl.host)) return true;
    } catch {
      // Malformed referer — reject
    }
  }

  return false;
}

/**
 * Route-handler authorization for sensitive APIs.
 *
 * Middleware remains the broad perimeter, but route handlers use this helper
 * as an independent boundary so a matcher or framework regression cannot
 * silently expose provider credentials or outbound network access.
 */
export function authorizeApiRequest(request: NextRequest): boolean {
  const apiSecret = process.env.API_SECRET;
  if (authenticateBearer(request, apiSecret)) return true;

  if (!apiSecret) {
    if (process.env.NODE_ENV !== "production") return true;
    return isSameOriginRequest(request);
  }

  return false;
}
