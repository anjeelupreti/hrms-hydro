import { NextResponse } from "next/server";

import { setAuthCookies } from "@/lib/server/authCookies";
import { djangoFetch } from "@/lib/server/djangoApi";

export async function POST(request: Request) {
  const { username, password, otp } = await request.json();

  const result = await djangoFetch("/api/v1/accounts/token/", {
    method: "POST",
    body: { username, password, otp },
  });

  if (!result.ok) {
    // Surface the 2FA challenge so the form can prompt for a code.
    return NextResponse.json(
      {
        detail: result.data?.detail ?? "Invalid credentials.",
        otp_required: Boolean(result.data?.otp_required),
      },
      { status: result.status }
    );
  }

  const response = NextResponse.json({ ok: true });
  setAuthCookies(response, { access: result.data.access, refresh: result.data.refresh });
  return response;
}
