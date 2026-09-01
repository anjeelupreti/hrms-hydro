import type { NextRequest } from "next/server";


const DJANGO_API_BASE_URL = process.env.DJANGO_API_BASE_URL ?? "http://127.0.0.1:8000";

/**
 * Trade the refresh cookie for a fresh access token.
 *
 * Lives here rather than inside the API proxy because it has two callers: the
 * proxy, and the media route that serves uploaded files. Access tokens last
 * fifteen minutes, so *any* route that carries a bearer token has to handle
 * their expiry, and a second private copy of this is how the two would come to
 * disagree.
 *
 * Returns `null` when there is nothing to refresh with, or the refresh itself
 * is refused. The caller decides what that means: the proxy clears the cookies
 * and reports 401, the media route simply fails to serve the file.
 */
export async function refreshAccessToken(request: NextRequest) {
  const refreshToken = request.cookies.get("refresh_token")?.value;
  if (!refreshToken) return null;

  const response = await fetch(`${DJANGO_API_BASE_URL}/api/v1/accounts/token/refresh/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh: refreshToken }),
    cache: "no-store",
  });
  if (!response.ok) return null;
  return response.json() as Promise<{ access: string; refresh: string }>;
}
