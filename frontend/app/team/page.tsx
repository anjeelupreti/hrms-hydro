"use client";

import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import AccessShape from "@/components/team/AccessShape";
import CountFilterBar from "@/components/common/CountFilterBar";
import EmptyState from "@/components/common/EmptyState";
import ListControls from "@/components/common/ListControls";
import ViewSwitch, { useViewMode } from "@/components/common/ViewSwitch";
import {
  useGrantPermission,
  useRevokePermission,
  useSetRole,
  useTeam,
  useTeamCatalogue,
} from "@/hooks/useTeam";
import type { TeamMember } from "@/types/team";

/**
 * Who holds what, and the two ways to change it.
 *
 * **Roles and grants are shown apart on purpose.** They are different kinds of
 * thing: a role is where somebody sits, a grant is one capability handed to
 * them. Merging them into a single list of toggles reads more simply and is
 * exactly the confusion the model was built to avoid — an admin would appear
 * to hold thirteen revocable switches, and revoking one would do nothing,
 * because the role grants it regardless.
 *
 * So grants only render for an `hr_officer`, the only role whose default is
 * nothing and therefore the only role a grant changes.
 */
export default function TeamPage() {
  const { data: members, isLoading } = useTeam();
  const { data: catalogue } = useTeamCatalogue();
  const setRole = useSetRole();
  const grant = useGrantPermission();
  const revoke = useRevokePermission();
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("");
  // List by default: this screen is read down a column — who holds what — and
  // the system has a handful of people with roles, not a hundred.
  const { mode: view, setMode: setView } = useViewMode("team", "list");

  const pending = setRole.isPending || grant.isPending || revoke.isPending;

  if (isLoading || !catalogue) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  const appointable = catalogue.roles.filter((r) => r.appointable);

  // Filtered here rather than on the server: this endpoint returns everyone who
  // can sign in, which is bounded by headcount and already on the page. A round
  // trip per keystroke would be slower and no more correct.
  const term = search.trim().toLowerCase();
  const shown = (members ?? []).filter((member) => {
    if (roleFilter && member.role !== roleFilter) return false;
    if (!term) return true;
    return [member.name, member.email, member.username, member.employee_code, member.department]
      .some((field) => field?.toLowerCase().includes(term));
  });

  const byRole = (role: string) => (members ?? []).filter((m) => m.role === role).length;

  function act(promise: Promise<unknown>) {
    setError("");
    promise.catch((e: Error) => setError(e.message));
  }

  function togglePermission(member: TeamMember, permission: string, held: boolean) {
    const mutation = held ? revoke : grant;
    act(mutation.mutateAsync({ userId: member.id, permission }));
  }

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <AdminPanelSettingsIcon /> Roles &amp; permissions
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          The owner appoints HR admins. An HR officer starts with nothing and holds only
          what is granted here.
        </Typography>
      </Box>

      {error ? <Alert severity="error" onClose={() => setError("")}>{error}</Alert> : null}

      {/* The filter bar is a card, like every other list screen in the app.
          A bare input floating above the content reads as page furniture
          rather than a control that belongs to the list below it. */}
      <Card sx={{ p: 2 }}>
        <ListControls
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search people…"
          searchLabel="Search people by name, email, code or department"
          trailing={<ViewSwitch value={view} onChange={setView} modes={["cards", "list"]} />}
        />
      </Card>

      {/* The reading, before the roster — and against every account, not the
          filtered view. A dormant admin does not stop holding payroll access
          because somebody selected "Employee" in the chips above. */}
      {isLoading ? null : <AccessShape members={members ?? []} />}

      {/* Counted from the same list the rows come from, so the chips cannot
          disagree with what is on screen. Roles are a closed set of four —
          there is no page cap here to make a client-side count wrong. */}
      <CountFilterBar
        ariaLabel="Filter people by role"
        value={roleFilter}
        onChange={setRoleFilter}
        options={[
          { value: "", label: "Everyone", count: members?.length },
          { value: "owner", label: "Owner", count: byRole("owner"), tone: "info" },
          { value: "hr_admin", label: "HR Admin", count: byRole("hr_admin") },
          { value: "hr_officer", label: "HR Officer", count: byRole("hr_officer") },
          { value: "employee", label: "Employee", count: byRole("employee") },
        ]}
      />

      {shown.length === 0 ? (
        <EmptyState
          title={search ? `Nobody matches “${search}”` : "Nobody here"}
          description={
            search
              ? "Try a name, an email address or an employee code."
              : "Everyone who can sign in appears here."
          }
        />
      ) : null}

      <Box
        sx={
          view === "cards"
            ? {
                display: "grid",
                gap: 2,
                gridTemplateColumns: { xs: "1fr", md: "1fr 1fr", xl: "1fr 1fr 1fr" },
              }
            : { display: "flex", flexDirection: "column", gap: 2 }
        }
      >
        {shown.map((member) => (
          <Card key={member.id} variant="outlined">
            <CardContent>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={2}
                sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {member.name}
                    {member.is_owner ? (
                      <Chip label="Owner" size="small" color="primary" sx={{ ml: 1 }} />
                    ) : null}
                    {!member.is_active ? (
                      <Chip label="Deactivated" size="small" sx={{ ml: 1 }} />
                    ) : null}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {member.email}
                    {member.employee_code ? ` \u00b7 ${member.employee_code}` : ""}
                    {member.department ? ` \u00b7 ${member.department}` : ""}
                  </Typography>
                </Box>

                {/* The owner's role is fixed — the one role that cannot be
                    handed around is what makes it a root of trust. Shown
                    disabled rather than hidden, so the rule is visible. */}
                <Tooltip
                  title={
                    member.is_owner
                      ? "The owner is set when the system is created and cannot be changed."
                      : ""
                  }
                >
                  <span>
                    <TextField
                      select
                      size="small"
                      label="Role"
                      value={member.role}
                      disabled={member.is_owner || pending}
                      sx={{ minWidth: 180 }}
                      onChange={(e) =>
                        act(setRole.mutateAsync({ userId: member.id, role: e.target.value }))
                      }
                    >
                      {appointable.map((role) => (
                        <MenuItem key={role.value} value={role.value}>
                          {role.label}
                        </MenuItem>
                      ))}
                      {member.is_owner ? <MenuItem value="owner">Owner</MenuItem> : null}
                    </TextField>
                  </span>
                </Tooltip>
              </Stack>

              {member.role === "hr_officer" ? (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="caption" color="text.secondary">
                    Capabilities
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, mt: 0.5 }}>
                    {catalogue.permissions
                      .filter((p) => p.grantable)
                      .map((p) => {
                        const held = member.grants.includes(p.value);
                        // Disabled when the actor does not hold it: `grant`
                        // refuses, and a control that 403s on click teaches
                        // nothing. The tooltip says why.
                        const blocked = !p.held_by_you && !held;
                        return (
                          <Tooltip
                            key={p.value}
                            title={blocked ? "You cannot grant a capability you do not hold." : ""}
                          >
                            <span>
                              <Chip
                                label={p.value}
                                size="small"
                                color={held ? "primary" : "default"}
                                variant={held ? "filled" : "outlined"}
                                disabled={blocked || pending}
                                onClick={() => togglePermission(member, p.value, held)}
                              />
                            </span>
                          </Tooltip>
                        );
                      })}
                  </Stack>
                </Box>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </Box>
    </Stack>
  );
}
