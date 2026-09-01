import { apiErrorMessage } from "@/lib/apiError";

/**
 * One fetch wrapper for every hook.
 *
 * **There were thirty-six of these**, one per hooks file, character-identical
 * and copied forward each time somebody added a module. Nothing was wrong with
 * any single copy; the problem is that a fix to error handling, a retry, or a
 * header lands in one of them and the other thirty-five keep the old behaviour
 * — and nobody finds out until the module nobody touched this quarter fails
 * differently from the rest.
 *
 * **Errors carry the server's own words.** `apiErrorMessage` digs the message
 * out of a DRF error body, so a refusal like "that milestone has been reached"
 * reaches the screen instead of "Request failed with status 400". The rules a
 * service enforces are worth explaining exactly once — in the service — and
 * this is what carries them out.
 */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  // A multipart body is only parseable if the header carries the boundary the
  // browser generated, so forcing `application/json` onto every request leaves
  // the server a body it cannot read — and each module that uploads anything
  // ends up forking this function to special-case `FormData`. The rule belongs
  // here once: given a `FormData`, say nothing and let the browser set it.
  const isFormData = init?.body instanceof FormData;
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(apiErrorMessage(data, response.status));
  }
  // 204 has no body at all, and calling `.json()` on it throws.
  if (response.status === 204) return undefined as T;
  return response.json();
}
