import { type NextRequest, NextResponse } from "next/server";

/**
 * Paths anybody may open, signed in or not.
 *
 * Kept as a list rather than folded into the matcher regex so each entry is
 * visible and argued for. Anything added here is world-readable, so it earns
 * its place one line at a time.
 */
const PUBLIC_PATHS = [
  "/careers",
  // The candidate's offer link. World-readable by necessity — they have no
  // account and must not need one to answer — and safe only because the path
  // carries a 256-bit secret and the endpoint behind it returns an allow-list
  // of six fields. Both of those are load-bearing; neither is obvious from
  // this line, which is why it is written down.
  "/offer",
];
// NOTE: a public page needs listing **twice** — here, so the request is not
// redirected to login, and in `components/shell/AppShellLayout.tsx`, so the
// signed-in chrome does not wrap it. Missing the second one renders a sidebar
// around a page written for somebody with no account.

// Next.js 16 renamed `middleware.ts` to `proxy.ts` (same purpose/API).
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has("refresh_token");
  const path = request.nextUrl.pathname;

  if (PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  // This is one company's internal system — there is no marketing site behind
  // `/`, and nothing to show somebody who is not signed in.
  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", path);
    return NextResponse.redirect(loginUrl);
  }

  if (path === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // `media` is excluded alongside `api` for the same reason: both are
    // fetched by code, not navigated to by a person. Redirecting an
    // unauthenticated one to the login page hands an `<img>` tag a page of
    // HTML, which it renders as a broken image with no clue why. The media
    // route answers a plain 401 instead — and the file itself is gated by
    // Django, so leaving the redirect off costs nothing.
    "/((?!api|media|_next/static|_next/image|favicon.ico|login|forgot-password|reset-password).*)",
  ],
};
