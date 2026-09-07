import { type NextRequest, NextResponse } from "next/server";

import { clearAuthCookies, setAuthCookies } from "@/lib/server/authCookies";
import { refreshAccessToken } from "@/lib/server/refreshToken";

const DJANGO_API_BASE_URL = process.env.DJANGO_API_BASE_URL ?? "http://127.0.0.1:8000";

/**
 * Uploaded files, served to the browser.
 *
 * **The other half of the URL rewrite in `app/api/proxy/[...path]`.** Django
 * builds a file's URL with `request.build_absolute_uri`, and the only client
 * that reaches Django is that proxy over the container network — so a photo
 * comes back as `http://backend:8000/media/...`, a hostname that exists only
 * inside Docker. The proxy rewrites those to a relative `/media/...`, and this
 * is the handler that was supposed to answer them.
 *
 * 🔴 **It did not exist.** The proxy's own comment described it, the rewrite
 * pointed at it, and nothing was there — so every uploaded file in the product
 * 404'd: employee photographs, site pictures, company logos, signature images,
 * letter attachments. Images fail silently in a browser, so this did not look
 * like a broken route; it looked like nobody had ever uploaded anything, and
 * an avatar falling back to initials looks entirely normal.
 *
 * **The bearer is re-attached here** because Django requires one for uploaded
 * files — an `<img>` tag cannot send an Authorization header, so the session
 * cookie has to be turned back into a token on this side. That is the whole
 * reason a static file needs a route handler at all.
 */
async function fetchFile(path: string[], accessToken: string | undefined) {
  const url = `${DJANGO_API_BASE_URL}/media/${path.map(encodeURIComponent).join("/")}`;
  return fetch(url, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    cache: "no-store",
  });
}

async function relay(upstream: Response) {
  if (!upstream.ok) {
    // The bytes of Django's 404 page are no use to an `<img>`; the status is.
    return new NextResponse(null, { status: upstream.status });
  }
  const body = await upstream.arrayBuffer();
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/octet-stream",
      // Private: these are somebody's identity document or signature, and a
      // shared cache holding them is a shared cache leaking them. The browser
      // may still keep its own copy, which is what makes a list of avatars
      // stop re-fetching on every render.
      "Cache-Control": "private, max-age=300",
    },
  });
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
) {
  const { path } = await ctx.params;
  const accessToken = request.cookies.get("access_token")?.value;

  let upstream = await fetchFile(path, accessToken);

  // The same 401-refresh dance the API proxy does. Without it every image on
  // the page breaks the moment the fifteen-minute token lapses, and comes back
  // on the next navigation — which is a maddening thing to report.
  if (upstream.status === 401) {
    const refreshed = await refreshAccessToken(request);
    if (!refreshed) {
      const response = new NextResponse(null, { status: 401 });
      clearAuthCookies(response);
      return response;
    }
    upstream = await fetchFile(path, refreshed.access);
    const response = await relay(upstream);
    setAuthCookies(response, { access: refreshed.access, refresh: refreshed.refresh });
    return response;
  }

  return relay(upstream);
}
