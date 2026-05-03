import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticateBearer, isSameOriginRequest } from "@/lib/auth";

const PROTECTED_PATTERNS = [/^\/api\/jobs(\/|$)/, /^\/api\/chat(\/|$)/, /^\/api\/providers(\/|$)/];

function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_PATTERNS.some((p) => p.test(pathname));
}

export function middleware(request: NextRequest) {
  if (!isProtectedRoute(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const apiSecret = process.env.API_SECRET;

  if (authenticateBearer(request, apiSecret)) {
    return NextResponse.next();
  }

  // No valid Bearer token — apply secondary checks when secret is unset
  if (!apiSecret) {
    if (process.env.NODE_ENV !== "production") {
      // Development convenience: allow all
      return NextResponse.next();
    }

    // Production without API_SECRET: only allow same-origin requests
    // as a lightweight defence-in-depth measure.
    if (isSameOriginRequest(request)) {
      return NextResponse.next();
    }
  }

  return NextResponse.json(
    { error: "Unauthorized — valid Authorization header required" },
    { status: 401 },
  );
}

export const config = {
  matcher: ["/api/jobs/:path*", "/api/chat", "/api/providers"],
};
