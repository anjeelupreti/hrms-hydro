/** Who may do what, as the server describes it. */

export type TeamMember = {
  id: number;
  username: string;
  name: string;
  email: string;
  role: string;
  role_label: string;
  is_active: boolean;
  employee_code: string | null;
  department: string | null;
  /** Everything they may do — role plus grants. */
  permissions: string[];
  /** Only what was handed to them explicitly. An admin's is empty: they hold
   *  everything by role, and showing that as revocable grants would invite
   *  somebody to try and be confused when nothing changes. */
  grants: string[];
  is_owner: boolean;
};

export type TeamRoleOption = {
  value: string;
  label: string;
  /** Owner is never appointable — `set_role` refuses, so the screen must not
   *  offer it and then fail. */
  appointable: boolean;
};

export type TeamPermissionOption = {
  value: string;
  /** `people.admin` is never grantable: a grantable "grant permissions" is how
   *  an officer becomes an admin in two steps. */
  grantable: boolean;
  /** You cannot hand out what you do not hold. */
  held_by_you: boolean;
};

export type TeamCatalogue = {
  roles: TeamRoleOption[];
  permissions: TeamPermissionOption[];
};
