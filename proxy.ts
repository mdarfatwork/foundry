import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { getSafeRedirectUrl } from "@/lib/auth/redirect";

/**
 * Next.js 16 Network Request Proxy / Middleware.
 * Optimistic session cookie verification and early boundary redirects.
 * Adheres to AGENTS.md §7.1, §7.4, and Prompt §8.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Bypass prefetch requests to prevent client router redirect loops with partialPrefetching
  const isPrefetch =
    request.headers.get("x-middleware-prefetch") === "1" ||
    request.headers.get("purpose") === "prefetch" ||
    request.headers.get("next-router-prefetch") === "1";

  if (isPrefetch) {
    return NextResponse.next();
  }

  const sessionCookie = getSessionCookie(request);

  const isProtected =
    pathname.startsWith("/workspace") || pathname.startsWith("/dashboard");
  const isAuthRoute = pathname.startsWith("/sign-in");

  // Redirect unauthenticated visitors attempting to access private routes
  if (isProtected && !sessionCookie) {
    const safeCallback = getSafeRedirectUrl(pathname + search, "/workspace");
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("callbackUrl", safeCallback);
    return NextResponse.redirect(signInUrl);
  }

  // Redirect authenticated visitors away from sign-in page
  if (isAuthRoute && sessionCookie) {
    const requestedCallback = request.nextUrl.searchParams.get("callbackUrl");
    const destination = getSafeRedirectUrl(requestedCallback, "/workspace");
    return NextResponse.redirect(new URL(destination, request.url));
  }

  return NextResponse.next();
}

// Next.js backwards-compatible alias
export { proxy as middleware };

export const config = {
  matcher: ["/workspace/:path*", "/dashboard/:path*", "/sign-in"],
};
