"use client";

/**
 * Departments and job titles.
 *
 * **This page did not exist, and both are must-have setup steps.** They could
 * be *picked* on an employee form and created only by a seed or the API — so a
 * genuinely new company was told to add their departments and given nowhere to
 * do it. The setup checklist pointed at a URL I had invented, which is how it
 * came to light.
 *
 * Two short lists on one page rather than two pages: they are the same kind of
 * decision, made at the same time, and nobody sets up departments on Tuesday
 * and job titles on Thursday.
 */

import AddIcon from "@mui/icons-material/Add";
import ApartmentIcon from "@mui/icons-material/Apartment";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Link from "@mui/material/Link";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";

import EditableRow from "@/components/settings/EditableRow";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import EmptyState from "@/components/common/EmptyState";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import NextLink from "next/link";

import {
  useCorporatePosts,
  useCorporateRoles,
  useDeleteCorporatePost,
  useDeleteCorporateRole,
  useSaveCorporatePost,
  useSaveCorporateRole,
} from "@/hooks/useEmployeeRecords";
import { useCan } from "@/hooks/useMe";
import {
  useCreateDepartment,
  useCreateDesignation,
  useDeleteDepartment,
  useUpdateDepartment,
  useUpdateDesignation,
  useDeleteDesignation,
  useDepartments,
  useDesignations,
} from "@/hooks/useOrgStructure";

function AddRow({
  label,
  placeholder,
  onAdd,
  pending,
}: {
  label: string;
  placeholder: string;
  onAdd: (value: string) => Promise<void>;
  pending: boolean;
}) {
  const [value, setValue] = useState("");

  async function submit() {
    if (!value.trim()) return;
    await onAdd(value.trim());
    setValue("");
  }

  return (
    <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
      <TextField
        size="small"
        fullWidth
        label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      />
      <Button startIcon={<AddIcon />} onClick={submit} disabled={!value.trim() || pending}>
        Add
      </Button>
    </Stack>
  );
}

export default function OrgStructurePage() {
  const canManage = useCan("people.manage");
  const { data: departments, isLoading: deptLoading } = useDepartments();
  const { data: designations, isLoading: desigLoading } = useDesignations();
  const { data: postPage } = useCorporatePosts();
  const { data: rolePage } = useCorporateRoles();
  const savePost = useSaveCorporatePost();
  const removePost = useDeleteCorporatePost();
  const saveRole = useSaveCorporateRole();
  const removeRole = useDeleteCorporateRole();
  const posts = postPage?.results ?? [];
  const roles = rolePage?.results ?? [];
  const createDept = useCreateDepartment();
  const createDesig = useCreateDesignation();
  const updateDept = useUpdateDepartment();
  const updateDesig = useUpdateDesignation();
  const removeDept = useDeleteDepartment();
  const removeDesig = useDeleteDesignation();
  const [error, setError] = useState("");

  async function run(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
    } catch (err) {
      // The server refuses a delete that would orphan employees and says which
      // — surfaced as-is rather than replaced with "could not delete".
      setError(err instanceof Error ? err.message : "That could not be saved.");
    }
  }

  const depts = departments?.results ?? [];
  const desigs = designations?.results ?? [];

  return (
    <PageContainer>
      <PageHeader
        title="Departments, posts and roles"
        subtitle="The structure every employee record is filed under"
        icon={<ApartmentIcon />}
      />

      {/* **Where the org chart comes from**, asked often enough to be worth
          answering on the page rather than in a manual. The chart is drawn
          from `Employee.manager` — who reports to whom — and nothing else.
          These lists give a person their department and title; the reporting
          line is set on the employee's own record. */}
      <Alert severity="info" sx={{ mb: 2 }}>
        The <strong>org chart</strong> is drawn from each employee&rsquo;s
        manager, set on their own record — not from anything on this page.
        These lists are what a person is filed under.{" "}
        <Link component={NextLink} href="/employees/org-chart">
          Open the chart
        </Link>
      </Alert>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      ) : null}

      <Stack direction={{ xs: "column", md: "row" }} spacing={2} useFlexGap>
        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Departments
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Reports and the org chart both group by these.
            </Typography>

            {deptLoading ? <CircularProgress size={20} sx={{ mt: 2 }} /> : null}

            {!deptLoading && depts.length === 0 ? (
              <Box sx={{ mt: 1 }}>
                <EmptyState
                  compact
                  title="No departments yet"
                  description="Add the teams your company is organised into — Engineering, Finance, Operations."
                />
              </Box>
            ) : null}

            <Stack spacing={0} sx={{ mt: 1 }}>
              {depts.map((row) => (
                <EditableRow
                  key={row.id}
                  value={row.name}
                  secondary={row.code || undefined}
                  canManage={canManage}
                  saving={updateDept.isPending}
                  placeholder="Engineering"
                  onSave={(name) => run(() => updateDept.mutateAsync({ id: row.id, values: { name } }))}
                  onRemove={() => run(() => removeDept.mutateAsync(row.id))}
                  removeHint="Remove — refused if anybody is still in it"
                />
              ))}
            </Stack>

            {canManage ? (
              <AddRow
                label="New department"
                placeholder="Engineering"
                pending={createDept.isPending}
                onAdd={(name) => run(() => createDept.mutateAsync({ name }))}
              />
            ) : null}
          </CardContent>
        </Card>

        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Job titles
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Offer letters and employee records both carry one.
            </Typography>

            {desigLoading ? <CircularProgress size={20} sx={{ mt: 2 }} /> : null}

            {!desigLoading && desigs.length === 0 ? (
              <Box sx={{ mt: 1 }}>
                <EmptyState
                  compact
                  title="No job titles yet"
                  description="Add the roles people are hired into — Engineer, Accountant, Sales Lead."
                />
              </Box>
            ) : null}

            <Stack spacing={0} sx={{ mt: 1 }}>
              {desigs.map((row) => (
                <EditableRow
                  key={row.id}
                  value={row.title}
                  secondary={
                    row.department_name ? (
                      <Typography variant="caption" color="text.secondary">
                        {row.department_name}
                      </Typography>
                    ) : undefined
                  }
                  canManage={canManage}
                  saving={updateDesig.isPending}
                  placeholder="Engineer"
                  onSave={(title) => run(() => updateDesig.mutateAsync({ id: row.id, values: { title } }))}
                  onRemove={() => run(() => removeDesig.mutateAsync(row.id))}
                  removeHint="Remove — refused if anybody still holds it"
                />
              ))}
            </Stack>

            {canManage ? (
              <AddRow
                label="New job title"
                placeholder="Software Engineer"
                pending={createDesig.isPending}
                onAdd={(title) => run(() => createDesig.mutateAsync({ title }))}
              />
            ) : null}
          </CardContent>
        </Card>
      </Stack>

      {/* ── The chair and the work ──────────────────────────────────────
          Two more lists, and they are not the same as a job title. A *post* is
          the establishment position somebody is appointed to — what their grade
          and seniority follow. A *role* is what they are actually responsible
          for. They move independently: two Deputy Managers hold different
          roles, and somebody promoted out of Senior Engineer usually keeps
          running the same site. */}
      <Stack direction={{ xs: "column", md: "row" }} spacing={2} useFlexGap sx={{ mt: 2 }}>
        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Corporate posts
            </Typography>
            <Typography variant="caption" color="text.secondary">
              The chair somebody is appointed to. Grade and seniority follow this.
            </Typography>

            {posts.length === 0 ? (
              <Box sx={{ mt: 1 }}>
                <EmptyState
                  compact
                  title="No posts yet"
                  description="Deputy Manager, Senior Engineer, Level 7 Officer — the positions people are appointed to."
                />
              </Box>
            ) : null}

            <Stack spacing={0} sx={{ mt: 1 }}>
              {posts.map((row) => (
                <EditableRow
                  key={row.id}
                  value={row.name}
                  secondary={
                    <Typography variant="caption" color="text.secondary">
                      {row.code}
                      {row.rank ? ` · rank ${row.rank}` : ""}
                      {row.employee_count ? ` · ${row.employee_count} holding it` : ""}
                    </Typography>
                  }
                  canManage={canManage}
                  saving={savePost.isPending}
                  placeholder="Deputy Manager"
                  onSave={(name) => run(() => savePost.mutateAsync({ id: row.id, values: { name } }))}
                  onRemove={() => run(() => removePost.mutateAsync(row.id))}
                  removeHint="Remove — refused if anybody still holds it"
                />
              ))}
            </Stack>

            {canManage ? (
              <AddRow
                label="New post"
                placeholder="Deputy Manager"
                pending={savePost.isPending}
                onAdd={(name) =>
                  run(() =>
                    savePost.mutateAsync({
                      // A code is required and nobody wants to type one twice.
                      // Derived from the name, upper-cased and stripped, which
                      // is what everybody types anyway.
                      values: { name, code: codeFrom(name) },
                    })
                  )
                }
              />
            ) : null}
          </CardContent>
        </Card>

        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Corporate roles
            </Typography>
            <Typography variant="caption" color="text.secondary">
              What somebody is responsible for, independent of their post.
            </Typography>

            {roles.length === 0 ? (
              <Box sx={{ mt: 1 }}>
                <EmptyState
                  compact
                  title="No roles yet"
                  description="Head of Electrical Maintenance, Project Manager for Sanjen, Company Secretary."
                />
              </Box>
            ) : null}

            <Stack spacing={0} sx={{ mt: 1 }}>
              {roles.map((row) => (
                <EditableRow
                  key={row.id}
                  value={row.name}
                  secondary={
                    <Typography variant="caption" color="text.secondary">
                      {row.code}
                      {row.company_name ? ` · ${row.company_name}` : ""}
                      {row.employee_count ? ` · ${row.employee_count} holding it` : ""}
                    </Typography>
                  }
                  canManage={canManage}
                  saving={saveRole.isPending}
                  placeholder="Head, Electrical Maintenance"
                  onSave={(name) => run(() => saveRole.mutateAsync({ id: row.id, values: { name } }))}
                  onRemove={() => run(() => removeRole.mutateAsync(row.id))}
                  removeHint="Remove — refused if anybody still holds it"
                />
              ))}
            </Stack>

            {canManage ? (
              <AddRow
                label="New role"
                placeholder="Head, Electrical Maintenance"
                pending={saveRole.isPending}
                onAdd={(name) =>
                  run(() => saveRole.mutateAsync({ values: { name, code: codeFrom(name) } }))
                }
              />
            ) : null}
          </CardContent>
        </Card>
      </Stack>
    </PageContainer>
  );
}

/**
 * A short code from a name.
 *
 * Both lookups require one and it is only ever used as an identifier on
 * exports, so asking for it twice on a form nobody wants to fill in is a cost
 * with no reader. Initials of the first three words, upper-cased, which is what
 * people type when asked.
 */
function codeFrom(name: string) {
  const initials = name
    .split(/[\s,/-]+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  return (initials || name.slice(0, 3)).toUpperCase().slice(0, 20);
}
