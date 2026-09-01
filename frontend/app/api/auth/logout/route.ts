import { type NextRequest, NextResponse } from "next/server";

import { clearAuthCookies } from "@/lib/server/authCookies";
import { djangoFetch } from "@/lib/server/djangoApi";

export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get("refresh_token")?.value;
  if (refreshToken) {
    await djangoFetch("/api/v1/accounts/token/blacklist/", {
      method: "POST",
      body: { refresh: refreshToken },
    });
  }

  const response = NextResponse.json({ ok: true });
  clearAuthCookies(response);
  return response;
}
