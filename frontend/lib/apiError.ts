/**
 * Turn a DRF error body into something a person can act on.
 *
 * **`data.detail` alone is not enough**, which is the whole reason this exists:
 *
 * ```ts
 * throw new Error(data.detail ?? `Request failed (${response.status})`);
 * ```
 *
 * `detail` is only present for non-field errors — a 403, a 404, a bare
 * `ValidationError("...")`. **Field errors arrive keyed by field**:
 * `{"last_working_date": ["Required for a resignation/termination."]}`, with no
 * `detail` at all. Read that way, every form validation error in the product
 * renders as "Request failed (400)" and the reason the server carefully wrote
 * is discarded on arrival.
 *
 * Reported from the browser as "why can't I terminate an employee" — the
 * answer was on the wire the whole time.
 */
export function apiErrorMessage(body: unknown, status: number): string {
  if (typeof body === "string" && body.trim()) return body;
  if (!body || typeof body !== "object") return `Request failed (${status})`;

  const data = body as Record<string, unknown>;

  // Non-field errors first — DRF's own key, and the most specific thing when
  // it is there.
  if (typeof data.detail === "string") return data.detail;

  // DRF's key for errors that belong to the whole object rather than a field.
  const nonField = data.non_field_errors;
  if (Array.isArray(nonField) && typeof nonField[0] === "string") return nonField[0];

  // Field errors. Named, because "This field is required" without saying which
  // field is barely better than the status code it replaced.
  const parts: string[] = [];
  for (const [field, value] of Object.entries(data)) {
    const message = Array.isArray(value) ? value[0] : value;
    if (typeof message !== "string") continue;
    parts.push(field === "non_field_errors" ? message : `${humanise(field)}: ${message}`);
  }

  // Capped at three. A form with eight bad fields produces a paragraph nobody
  // reads; the first few get somebody moving, and the rest are still on screen
  // beside the inputs.
  if (parts.length > 3) {
    return `${parts.slice(0, 3).join(" ")} (+${parts.length - 3} more)`;
  }
  return parts.length > 0 ? parts.join(" ") : `Request failed (${status})`;
}

/** `last_working_date` → `Last working date`. */
function humanise(field: string): string {
  const words = field.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
