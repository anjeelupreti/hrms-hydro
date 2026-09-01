import { type NextRequest, NextResponse } from "next/server";

import { clearAuthCookies, setAuthCookies } from "@/lib/server/authCookies";
import { refreshAccessToken } from "@/lib/server/refreshToken";

const DJANGO_API_BASE_URL = process.env.DJANGO_API_BASE_URL ?? "http://127.0.0.1:8000";

// Response/NextResponse throws if a non-null body is paired with a status
// that must have none (204/205/304) — even an empty string body.
const NO_BODY_STATUSES = [204, 205, 304];

/**
 * Turn file URLs built against the private network into ones a browser can use.
 *
 * Django composes a file's URL with `request.build_absolute_uri`, and the only
 * client that reaches Django is this proxy, over the container network — so a
 * photo comes back as `http://backend:8000/media/...`, a hostname that exists
 * only inside Docker. Handed to an `<img>` it fails without a word, which reads
 * as "uploads are broken" rather than as a URL problem.
 *
 * Rewritten here because here is where the mistake is made: this hop is the
 * boundary between the private origin and the public one, and it is the only
 * place that knows both. The result is a relative `/media/...` path, served by
 * the route handler at `app/media/[...path]` — which re-attaches the session as
 * a bearer token, because Django now requires one for uploaded files.
 *
 * Deliberately anchored to the *exact* internal origin rather than matching
 * anything that looks like a file URL. When media moves to a bucket, those URLs
 * are absolute, signed, and none of our business — they will not match this,
 * and they will pass through untouched.
 */
function toBrowserReachableUrls(json: string) {
  return json.split(`${DJANGO_API_BASE_URL}/media/`).join("/media/");
}

async function relayResponse(upstream: Response) {
  // arrayBuffer, not text() — a text() round-trip UTF-8 decodes/re-encodes
  // the body, which silently corrupts binary payloads (payslip PDFs via
  // PayslipViewSet.download). Passing raw bytes through works for JSON too.
  let body: ArrayBuffer | string = await upstream.arrayBuffer();
  const headers: Record<string, string> = {
    "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
  };

  // Only JSON is decoded and rewritten. A payslip PDF or an exported workbook
  // stays raw bytes for the reason above.
  if (headers["Content-Type"].includes("application/json")) {
    body = toBrowserReachableUrls(new TextDecoder().decode(body));
  }
  const disposition = upstream.headers.get("Content-Disposition");
  if (disposition) headers["Content-Disposition"] = disposition;

  return new NextResponse(NO_BODY_STATUSES.includes(upstream.status) ? null : body, {
    status: upstream.status,
    headers,
  });
}

async function forward(
  request: NextRequest,
  path: string[],
  accessToken: string | undefined,
  /**
   * Read once by the caller, not here.
   *
   * A Request body is a stream and can only be consumed once. Reading it here
   * works until the access token expires: `handler` then refreshes and calls
   * `forward` a *second* time, and the retry throws "Body is unusable: Body
   * has already been read". Every write — save an employee, approve leave, run
   * payroll — would fail permanently once the 15-minute token lapsed, looking
   * exactly like the backend being unreachable.
   */
  body: ArrayBuffer | undefined
) {
  const search = request.nextUrl.search;
  const url = `${DJANGO_API_BASE_URL}/api/v1/${path.join("/")}/${search}`;
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const hasBody = body !== undefined;
  if (hasBody) {
    // Preserve the original Content-Type (e.g. multipart/form-data with
    // its boundary, for file uploads like the company logo) rather than
    // forcing application/json — and read as arrayBuffer, not text(),
    // since text() would corrupt binary multipart bodies the same way
    // it once corrupted binary PDF download responses (see relayResponse).
    headers["Content-Type"] = request.headers.get("Content-Type") ?? "application/json";
  }

  return fetch(url, {
    method: request.method,
    headers,
    body,
    cache: "no-store",
  });
}


async function handler(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const accessToken = request.cookies.get("access_token")?.value;

  // Buffer the body up front so the 401-retry below can reuse it.
  const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer();

  let upstream = await forward(request, path, accessToken, body);

  if (upstream.status === 401) {
    const refreshed = await refreshAccessToken(request);
    if (!refreshed) {
      const response = new NextResponse(await upstream.text(), { status: 401 });
      clearAuthCookies(response);
      return response;
    }
    upstream = await forward(request, path, refreshed.access, body);
    const response = await relayResponse(upstream);
    setAuthCookies(response, { access: refreshed.access, refresh: refreshed.refresh });
    return response;
  }

  return relayResponse(upstream);
}

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
};
