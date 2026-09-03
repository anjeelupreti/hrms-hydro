/**
 * A person's name with their employee ID beside it.
 *
 * **Why every name carries one.** Nepali offices run on repeated names — two
 * Sitas in accounts, three Gurungs on the site team — and a memorandum that
 * says only "Recommended by Sita Sharma" is genuinely ambiguous about who
 * signed it. The employee ID is the thing that is unique, so it travels with
 * the name wherever the name is used to identify somebody: a chain, an
 * approval, a payslip, a letter that will be filed on paper.
 *
 * Deliberately one function rather than a component, so it works in the places
 * a component cannot go — a data-grid `valueGetter`, a `getOptionLabel`, an
 * `aria-label`, a search string, a filename.
 *
 * Falls back to the bare name rather than printing an empty bracket: not every
 * person in the system is an employee with a code (an external participant on a
 * field visit, a system account), and `Name ()` reads as missing data.
 */
export function withCode(
  name: string | null | undefined,
  code: string | null | undefined
): string {
  const person = (name ?? "").trim();
  const id = (code ?? "").trim();
  if (!person) return id ? `(${id})` : "";
  return id ? `${person} (${id})` : person;
}
