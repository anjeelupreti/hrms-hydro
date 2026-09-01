"use client";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import type { TeamMember } from "@/types/team";

/**
 * Who can do the dangerous things — the question an access page exists for.
 *
 * **A list of accounts sorted by name cannot answer "who could do real damage",
 * and that is the only question this page is for.** Headcount is the employees
 * module's business. Here the reading that matters is the shape of privilege:
 * how concentrated it is, and whether anybody holds power they should not.
 *
 * **A deactivated account keeps its role and its grants.** Verified rather than
 * assumed: `revoke_access` writes `is_active = False` and nothing else, and
 * grants are cleared on a *role change* (`accounts/policy.py`) — not on
 * deactivation. `restore_access` flips the flag back with everything intact.
 *
 * That is a defensible design, not a bug: a rescinded termination should give
 * the person their job back rather than a fortnight of re-granting. But it does
 * mean a dormant account is a live entitlement waiting to be switched on, and
 * the list could not show it — a deactivated admin looks like any other greyed
 * row. So it is surfaced in *warning*, not alarm: something to look at when
 * somebody has left for good, not an error to fix.
 *
 * **Privileged is counted from `permissions`, not from `role`.** A grant can
 * hand an ordinary account an administrative capability without changing its
 * role label, which is exactly the case a role-based count would miss — and
 * exactly the case worth catching.
 *
 * **The bar is one row of blocks, not a pie.** The claim is "this many of these
 * people", so the marks are the people: one block each, privileged ones filled.
 * A percentage would hide the count, and on a team of nine "22%" is a worse
 * sentence than "two of nine".
 */

/**
 * Capabilities that move money, expose what people are paid, or hand out more
 * access — checked against the real enum in `accounts/policy.py` rather than
 * guessed. A prefix that matches nothing sits here looking meaningful and
 * describes no account ever, so every entry below is one that exists.
 *
 * `payroll.view` is in the list although it writes nothing. The question is who
 * could do damage, and seeing everybody's salary is a disclosure that cannot be
 * taken back.
 */
const SENSITIVE = [
  "people.admin",
  "settings.manage",
  "payroll.view",
  "payroll.run",
  "expenses.manage",
];

function isPrivileged(member: TeamMember) {
  return (
    member.is_owner ||
    member.permissions.some((permission) => SENSITIVE.some((s) => permission.startsWith(s)))
  );
}

export default function AccessShape({ members }: { members: TeamMember[] }) {
  if (members.length === 0) return null;

  const privileged = members.filter(isPrivileged);
  const owners = members.filter((m) => m.is_owner);
  // The real hazard: switched off, still entitled.
  const dormant = members.filter((m) => !m.is_active && isPrivileged(m));
  const granted = members.filter((m) => !m.is_owner && m.grants.length > 0);

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between" }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Who holds what
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {members.length} {members.length === 1 ? "account" : "accounts"}
          </Typography>
        </Stack>

        {/* The finding, before the marks. Dormant-but-entitled leads whenever
            it exists: it is the only one that is a standing risk rather than a
            description. */}
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
          {dormant.length > 0
            ? `${dormant.length} deactivated ${dormant.length === 1 ? "account still holds" : "accounts still hold"} privileged access — deactivation closes the login but keeps the entitlements, so reactivating restores them in full.`
            : owners.length === 1 && members.length > 3
              ? `One owner. If that account is lost, nobody else can appoint a replacement.`
              : `${privileged.length} of ${members.length} can reach payroll, expenses or settings.`}
        </Typography>

        <Box sx={{ display: "flex", flexWrap: "wrap", gap: "3px", mb: 2 }}>
          {members.map((member) => {
            const privilege = isPrivileged(member);
            return (
              <Tooltip
                key={member.id}
                title={`${member.name} — ${member.role_label}${member.is_active ? "" : " (deactivated)"}${
                  member.grants.length ? ` · ${member.grants.length} extra grant${member.grants.length === 1 ? "" : "s"}` : ""
                }`}
              >
                <Box
                  sx={{
                    width: 18,
                    height: 18,
                    borderRadius: "3px",
                    ...(privilege
                      ? member.is_active
                        ? { bgcolor: "primary.main", opacity: 0.9 }
                        : {
                            // Off, but still entitled — the one state worth a
                            // status colour, because it is the one nothing else
                            // on the page can show.
                            border: "1.5px solid",
                            borderColor: "var(--hrms-status-warning-solid)",
                            bgcolor: "transparent",
                          }
                      : { bgcolor: "action.hover" }),
                  }}
                />
              </Tooltip>
            );
          })}
        </Box>

        <Stack direction="row" spacing={2.5} sx={{ flexWrap: "wrap", rowGap: 1 }}>
          {[
            { label: `${privileged.filter((m) => m.is_active).length} privileged`, sx: { bgcolor: "primary.main", opacity: 0.9 } },
            { label: `${members.length - privileged.length} standard`, sx: { bgcolor: "action.hover" } },
            ...(dormant.length
              ? [
                  {
                    label: `${dormant.length} off but entitled`,
                    sx: { border: "1.5px solid", borderColor: "var(--hrms-status-warning-solid)" },
                  },
                ]
              : []),
            ...(granted.length
              ? [{ label: `${granted.length} with extra grants`, sx: { bgcolor: "primary.main", opacity: 0.4 } }]
              : []),
          ].map((item) => (
            <Stack key={item.label} direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
              <Box sx={{ width: 10, height: 10, borderRadius: "2px", ...item.sx }} />
              <Typography variant="caption" color="text.secondary">
                {item.label}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}
