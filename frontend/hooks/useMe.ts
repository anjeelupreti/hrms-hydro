"use client";

import { useQuery } from "@tanstack/react-query";

type Me = {
  id: number;
  username: string;
  email: string;
  role: "owner" | "hr_admin" | "hr_officer" | "employee";
  is_superuser: boolean;
  employee_id: number | null;
  /** The name a letter would be signed with, not the login. */
  full_name: string;
  /** Empty for an account with no employee record. */
  employee_code: string;
  /** True while the password is one the system generated and mailed in plain
   *  text — a new account, or a confirmed reset. The shell blocks on this
   *  until they choose their own. */
  must_change_password: boolean;
  /** Capabilities this user holds, named exactly as `accounts/policy.py` does.
   *  Sent by the server rather than inferred from `role` here — a browser
   *  guessing at authorisation is how a menu and its API drift apart. */
  permissions: string[];
};

async function fetchMe(): Promise<Me> {
  const response = await fetch("/api/proxy/accounts/me");
  if (!response.ok) throw new Error("Not authenticated");
  return response.json();
}

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: fetchMe });
}

/**
 * Whether the signed-in user holds a capability.
 *
 * **Use this instead of `me.role === "hr_admin"`.** That comparison is spread
 * across roughly thirty pages and is wrong for the two roles added in Phase 1:
 * an owner is not `hr_admin`, and an HR officer holding exactly one granted
 * capability is not `hr_admin` either — so a role comparison either hides
 * something they may do or shows something they may not.
 *
 * Returns `false` while `/me/` is still loading, which is the safe direction:
 * a control that appears late is better than one that flashes and vanishes.
 */
export function useCan(permission: string): boolean {
  const { data: me } = useMe();
  return Boolean(me?.permissions?.includes(permission));
}

/** The whole set, for code deciding several things at once. */
export function usePermissions(): string[] {
  const { data: me } = useMe();
  return me?.permissions ?? [];
}

/**
 * May this user bring a *new* record of this kind into existence?
 *
 * **The browser's half of the verb split**, mirroring `accounts.policy.can_create`
 * clause for clause: holding the capability is required, and the role decides
 * whether holding it extends as far as creating. An HR officer with
 * `people.manage` may edit an employee and may not add one.
 *
 * Here rather than as `me?.role === "hr_admin" || …` on each page, because that
 * is the fifty-one-site pattern `accounts/policy.py` was written to end,
 * reappearing on the other side of the wire. The API refuses regardless; this
 * is only so a button that would be refused is not offered — a form somebody
 * fills in and is then told they may not submit is the "looks broken rather
 * than secure" failure.
 *
 * If this and `can_create` ever disagree, the server is right.
 */
export function useCanCreate(permission: string): boolean {
  const { data: me } = useMe();
  if (!me?.permissions?.includes(permission)) return false;
  return me.is_superuser || me.role === "owner" || me.role === "hr_admin";
}

/** The same, for deletion. A separate function because the server keeps them
 *  separate — the two sets are equal today and deliberately not derived from
 *  one another, since deletion is the act with no undo. */
export function useCanDelete(permission: string): boolean {
  const { data: me } = useMe();
  if (!me?.permissions?.includes(permission)) return false;
  return me.is_superuser || me.role === "owner" || me.role === "hr_admin";
}

/**
 * What a role is called to the person holding it.
 *
 * Four roles, so a two-way ternary cannot render them: `"HR Admin"` or
 * `"Employee"` labels an owner as an employee and an HR officer as one too —
 * wrong twice over, in the place people look to check who they are.
 */
export const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  hr_admin: "HR Admin",
  hr_officer: "HR Officer",
  employee: "Employee",
};

export function roleLabel(role: string | undefined): string {
  return ROLE_LABELS[role ?? "employee"] ?? "Employee";
}
