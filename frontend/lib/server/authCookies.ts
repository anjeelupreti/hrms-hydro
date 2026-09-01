import type { NextResponse } from "next/server";

const ACCESS_TOKEN_MAX_AGE = 15 * 60; // matches backend SIMPLE_JWT.ACCESS_TOKEN_LIFETIME
const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60; // matches SIMPLE_JWT.REFRESH_TOKEN_LIFETIME

const isProduction = process.env.NODE_ENV === "production";

const baseCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: "lax" as const,
  path: "/",
  // No `domain` set deliberately: host-only cookies so a session on one
  // company subdomain can never be replayed against another.
};

export function setAuthCookies(
  response: NextResponse,
  tokens: { access: string; refresh: string }
) {
  response.cookies.set("access_token", tokens.access, {
    ...baseCookieOptions,
    maxAge: ACCESS_TOKEN_MAX_AGE,
  });
  response.cookies.set("refresh_token", tokens.refresh, {
    ...baseCookieOptions,
    maxAge: REFRESH_TOKEN_MAX_AGE,
  });
}

export function clearAuthCookies(response: NextResponse) {
  response.cookies.delete("access_token");
  response.cookies.delete("refresh_token");
}
