import { type NextRequest, NextResponse } from "next/server";

import { clearAuthCookies, setAuthCookies } from "@/lib/server/authCookies";
import { djangoFetch } from "@/lib/server/djangoApi";

export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get("refresh_token")?.value;
  if (!refreshToken) {
    return NextResponse.json({ detail: "Not authenticated." }, { status: 401 });
  }
  const result = await djangoFetch("/api/v1/accounts/token/refresh/", {
    method: "POST",
    body: { refresh: refreshToken },
  });

  if (!result.ok) {
    const response = NextResponse.json(
      { detail: result.data?.detail ?? "Session expired." },
      { status: 401 }
    );
    clearAuthCookies(response);
    return response;
  }

  const response = NextResponse.json({ ok: true });
  setAuthCookies(response, { access: result.data.access, refresh: result.data.refresh });
  return response;
}
