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
        title="Departments & job titles"
        subtitle="The structure every employee record is filed under"
        icon={<ApartmentIcon />}
      />

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
    </PageContainer>
  );
}
