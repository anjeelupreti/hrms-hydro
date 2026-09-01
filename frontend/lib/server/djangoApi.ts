const DJANGO_API_BASE_URL = process.env.DJANGO_API_BASE_URL ?? "http://127.0.0.1:8000";

type DjangoFetchOptions = {
  method?: string;
  body?: unknown;
  accessToken?: string;
};

/** Calls Django's API server-to-server, optionally with a bearer token.
 * Never called from the browser directly. */
export async function djangoFetch(path: string, options: DjangoFetchOptions = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }

  const response = await fetch(`${DJANGO_API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  const text = await response.text();

  // **Django does not always answer in JSON, and blindly parsing hid that.**
  // A `DisallowedHost`, a 404 outside the API, or an unhandled 500 all come
  // back as an HTML debug page — and `JSON.parse` on that threw *inside* the
  // BFF, so the browser saw an opaque 500 and Django's real status and reason
  // were thrown away on the way past. A misconfigured host looked exactly like
  // a broken login.
  //
  // Now the real status is preserved and the body is reported as text, so the
  // thing that actually went wrong is legible from the network tab.
  const data = text ? parseOrDescribe(text, response.status) : null;
  return { ok: response.ok, status: response.status, data };
}

/** JSON when it is JSON, and a readable explanation when it is not.
 *
 * Returns `JSON.parse`'s own loose type so every existing caller keeps reading
 * `result.data.detail` exactly as before — the change here is what happens on
 * *failure*, not what a successful parse looks like.
 */
function parseOrDescribe(raw: string, status: number) {
  try {
    return JSON.parse(raw);
  } catch {
    return {
      detail:
        `The API returned ${status} but not JSON. ` +
        `First bytes: ${raw.slice(0, 200)}`,
    };
  }
}
