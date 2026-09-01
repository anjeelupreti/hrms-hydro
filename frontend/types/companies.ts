/**
 * The group's operating companies.
 *
 * Not the same thing as `CompanyProfile` in `types/organization.ts`. That is
 * the singleton the deployment itself runs on — the calendar, the office hours,
 * the timezone. This is a *list*: a hydropower group runs several legal
 * entities at once, typically one per project, and a person is employed by one
 * of them while working across others.
 */

export type CompanyKind = "parent" | "subsidiary" | "spv" | "jv" | "branch";

export type ProjectStage =
  | "survey"
  | "licensed"
  | "construction"
  | "commissioning"
  | "operation"
  | "na";

export type Company = {
  id: number;
  name: string;
  /** Short form, used on payroll exports and anywhere a legal name will not fit. */
  code: string;
  legal_name: string;
  kind: CompanyKind;
  kind_display: string;
  parent: number | null;
  parent_name: string | null;

  registration_number: string;
  pan_vat_number: string;
  licence_number: string;
  established_on: string | null;

  project_stage: ProjectStage;
  project_stage_display: string;
  /** Megawatts, as a decimal string — 4.5 and 25.5 MW plants are ordinary and
   *  rounding one to 5 misstates a licence. */
  installed_capacity_mw: string | null;
  river: string;

  address: string;
  district: string;
  province: string;
  phone: string;
  email: string;
  website: string;
  logo: string | null;

  /** Wound up rather than deleted — it still owns the employment history of
   *  everyone who worked for it. */
  is_active: boolean;
  /** Active people on *this* company's payroll. Secondments are not counted:
   *  they are somebody else's headcount. */
  employee_count: number;
  created_at: string;
  updated_at: string;
};

/** What a picker needs, and nothing more. */
export type CompanyOption = {
  id: number;
  name: string;
  code: string;
  kind: CompanyKind;
};

export type CompanyFormValues = {
  name: string;
  code: string;
  legal_name: string;
  kind: CompanyKind;
  parent: number | null;
  registration_number: string;
  pan_vat_number: string;
  licence_number: string;
  established_on: string;
  project_stage: ProjectStage;
  installed_capacity_mw: string;
  river: string;
  address: string;
  district: string;
  province: string;
  phone: string;
  email: string;
  website: string;
  is_active: boolean;
};

export const COMPANY_KINDS: { value: CompanyKind; label: string }[] = [
  { value: "parent", label: "Parent / holding" },
  { value: "subsidiary", label: "Subsidiary" },
  { value: "spv", label: "Project company (SPV)" },
  { value: "jv", label: "Joint venture" },
  { value: "branch", label: "Branch office" },
];

export const PROJECT_STAGES: { value: ProjectStage; label: string }[] = [
  { value: "na", label: "Not a project company" },
  { value: "survey", label: "Survey / feasibility" },
  { value: "licensed", label: "Licensed, pre-construction" },
  { value: "construction", label: "Under construction" },
  { value: "commissioning", label: "Commissioning" },
  { value: "operation", label: "In operation" },
];
