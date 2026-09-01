import { NextResponse } from "next/server";

import { djangoFetch } from "@/lib/server/djangoApi";

export async function POST(request: Request) {
  const { uid, token } = await request.json();
  const result = await djangoFetch("/api/v1/accounts/password-reset/confirm/", {
    method: "POST",
    body: { uid, token },
  });

  if (!result.ok) {
    return NextResponse.json(
      { detail: result.data?.detail ?? "This reset link is invalid or has expired." },
      { status: result.status }
    );
  }
  return NextResponse.json({ ok: true });
}
