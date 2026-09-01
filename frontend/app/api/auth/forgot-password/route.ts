import { NextResponse } from "next/server";

import { djangoFetch } from "@/lib/server/djangoApi";

export async function POST(request: Request) {
  const { email } = await request.json();
  await djangoFetch("/api/v1/accounts/password-reset/request/", {
    method: "POST",
    body: { email },
  });
  // Always 200: don't reveal whether the email exists.
  return NextResponse.json({ ok: true });
}
