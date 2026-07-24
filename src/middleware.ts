import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticateBearer, isSameOriginRequest } from "@/lib/auth";
import {
  createJobSessionToken,
  isValidJobSessionToken,
  JOB_SESSION_COOKIE_NAME,
  JOB_SESSION_HEADER,
} from "@/lib/job-session";

const PROTECTED_PATTERNS = [
  /^\/api\/jobs(\/|$)/,
  /^\/api\/chat(\/|$)/,
  /^\/api\/providers(\/|$)/,
  /^\/artifacts(\/|$)/,
];

function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_PATTERNS.some((p) => p.test(pathname));
}

export function middleware(request: NextRequest) {
  if (!isProtectedRoute(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const apiSecret = process.env.API_SECRET;

  if (apiSecret && authenticateBearer(request, apiSecret)) {
    return NextResponse.next();
  }

  let browserRequestAllowed = false;

  // No valid Bearer token: apply secondary checks when the secret is unset.
  if (!apiSecret) {
    if (process.env.NODE_ENV !== "production") {
      browserRequestAllowed = true;
    }

    // Production without API_SECRET: only allow same-origin requests
    // as a lightweight defence-in-depth measure.
    if (process.env.NODE_ENV === "production" && isSameOriginRequest(request)) {
      browserRequestAllowed = true;
    }
  }

  if (browserRequestAllowed) {
    const requestHeaders = new Headers(request.headers);
    const existingToken = request.cookies.get(JOB_SESSION_COOKIE_NAME)?.value;
    const token = isValidJobSessionToken(existingToken)
      ? existingToken
      : createJobSessionToken();

    // Always overwrite this internal header so callers cannot spoof a scope.
    requestHeaders.set(JOB_SESSION_HEADER, token);
    const response = NextResponse.next({
      request: { headers: requestHeaders },
    });

    if (token !== existingToken) {
      response.cookies.set({
        name: JOB_SESSION_COOKIE_NAME,
        value: token,
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    }

    return response;
  }

  return NextResponse.json(
    { error: "Unauthorized — valid Authorization header required" },
    { status: 401 },
  );
}

export const config = {
  matcher: [
    "/api/jobs/:path*",
    "/api/chat",
    "/api/providers/:path*",
    "/artifacts/:path*",
  ],
};
