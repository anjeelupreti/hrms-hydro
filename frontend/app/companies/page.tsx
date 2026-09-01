"use client";

import AddIcon from "@mui/icons-material/Add";
import ApartmentIcon from "@mui/icons-material/Apartment";
import BoltIcon from "@mui/icons-material/Bolt";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import EditIcon from "@mui/icons-material/Edit";
import PeopleIcon from "@mui/icons-material/People";
import WaterIcon from "@mui/icons-material/Water";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useState } from "react";

import ConfirmDialog from "@/components/common/ConfirmDialog";
import EmptyState from "@/components/common/EmptyState";
import SearchField from "@/components/common/SearchField";
import CompanyFormDialog from "@/components/companies/CompanyFormDialog";
import Breadcrumbs from "@/components/shell/Breadcrumbs";
import PageContainer from "@/components/shell/PageContainer";
import { useCompanies, useDeleteCompany } from "@/hooks/useCompanies";
import { useCan, useMe } from "@/hooks/useMe";
import type { Company } from "@/types/companies";

/**
 * The legal entities people are employed by.
 *
 * A hydropower group is not one company. It is a holding company and a project
 * company per licence, each with its own registration, its own board and its
 * own payroll — and an employee belongs to one of them while frequently working
 * across several. Until this existed the product had a single unnamed "company"
 * and no way to say which of them a person was actually employed by, so a
 * payslip could not name its own issuer.
 *
 * **Reading is open to anyone who can reach the page; writing is not.** An
 * employee's profile names their company, so the list has to resolve for
 * everybody or the name renders as a number. Creating one is an HR-admin act
 * and deleting one is refused outright while anybody is on its payroll — see
 * `CompanyViewSet.destroy`, which says so with the count rather than failing on
 * a foreign key.
 */

function capacity(company: Company) {
  if (!company.installed_capacity_mw) return null;
  // Trailing zeros off — the API stores three decimals so 42.5 arrives as
  // "42.500", and a card reading "42.500 MW" looks like a measurement rather
  // than a licence figure.
  return `${Number(company.installed_capacity_mw)} MW`;
}

export default function CompaniesPage() {
  const { data: me } = useMe();
  const canManage = useCan("settings.manage");
  // Creating and deleting are the admin's; an officer may keep the details
  // current. The API enforces this independently — this only stops the page
  // offering a button that would come back 403.
  const isAdmin = me?.role === "owner" || me?.role === "hr_admin" || Boolean(me?.is_superuser);

  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Company | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<Company | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data, isLoading } = useCompanies({ search: search || undefined, pageSize: 100 });
  const remove = useDeleteCompany();
  const companies = data?.results ?? [];

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(company: Company) {
    setEditing(company);
    setFormOpen(true);
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteError(null);
    try {
      await remove.mutateAsync(deleting.id);
      setDeleting(null);
    } catch (err) {
      setDeleteError(
        err instanceof Error
          ? err.message
          : "That company could not be removed. Move its people first, or deactivate it instead."
      );
    }
  }

  return (
    <PageContainer>
      <Breadcrumbs />

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ alignItems: { sm: "center" }, justifyContent: "space-between", mb: 2 }}
      >
        <Box>
          <Typography variant="h5">Companies</Typography>
          <Typography variant="body2" color="text.secondary">
            The entities people are employed by. One employee has one primary
            company and may work for any number of others.
          </Typography>
        </Box>
        {isAdmin && canManage ? (
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            Add company
          </Button>
        ) : null}
      </Stack>

      <Box sx={{ mb: 2, maxWidth: 420 }}>
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Name, code, registration or river…"
        />
      </Box>

      {isLoading ? (
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} variant="rounded" height={190} />
          ))}
        </Box>
      ) : companies.length === 0 ? (
        <EmptyState
          title={search ? `Nothing matches “${search}”` : "No companies yet"}
          description={
            search
              ? "Try a name, a code or the river the project is on."
              : "Add the holding company first, then a company per project."
          }
        />
      ) : (
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
          {companies.map((company) => (
            <Card key={company.id} sx={{ opacity: company.is_active ? 1 : 0.6 }}>
              <CardContent>
                <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
                  <ApartmentIcon color="primary" />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 700, lineHeight: 1.25 }}>
                      {company.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {company.code}
                      {company.parent_name ? ` · under ${company.parent_name}` : ""}
                    </Typography>
                  </Box>
                  {canManage ? (
                    <Stack direction="row">
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => openEdit(company)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {isAdmin ? (
                        <Tooltip
                          title={
                            company.employee_count > 0
                              ? "Somebody is on this payroll — deactivate it instead"
                              : "Remove"
                          }
                        >
                          {/* A span, so the tooltip still shows on a disabled
                              button — otherwise the one case that needs an
                              explanation is the one that gives none. */}
                          <span>
                            <IconButton
                              size="small"
                              disabled={company.employee_count > 0}
                              onClick={() => {
                                setDeleteError(null);
                                setDeleting(company);
                              }}
                            >
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      ) : null}
                    </Stack>
                  ) : null}
                </Stack>

                <Stack direction="row" spacing={0.75} sx={{ mt: 1.5, flexWrap: "wrap" }} useFlexGap>
                  <Chip size="small" label={company.kind_display} />
                  {company.project_stage !== "na" ? (
                    <Chip size="small" variant="outlined" label={company.project_stage_display} />
                  ) : null}
                  {!company.is_active ? (
                    <Chip size="small" color="default" variant="outlined" label="Inactive" />
                  ) : null}
                </Stack>

                <Stack spacing={0.75} sx={{ mt: 2, color: "text.secondary" }}>
                  {capacity(company) ? (
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                      <BoltIcon fontSize="small" />
                      <Typography variant="body2">{capacity(company)}</Typography>
                    </Stack>
                  ) : null}
                  {company.river ? (
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                      <WaterIcon fontSize="small" />
                      <Typography variant="body2">{company.river}</Typography>
                    </Stack>
                  ) : null}
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <PeopleIcon fontSize="small" />
                    {/* Straight through to the roster filtered to this company,
                        which is the next thing anybody wants after reading a
                        headcount. The filter matches secondments too, so the
                        list is wider than this number — which is the point of
                        the two being different. */}
                    <Typography
                      variant="body2"
                      component={Link}
                      href={`/employees?company=${company.id}`}
                      sx={{ color: "inherit", textDecoration: "none", "&:hover": { textDecoration: "underline" } }}
                    >
                      {company.employee_count} on payroll
                    </Typography>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Box>
      )}

      <CompanyFormDialog open={formOpen} onClose={() => setFormOpen(false)} company={editing} />

      <ConfirmDialog
        open={deleting !== null}
        title={`Remove ${deleting?.name ?? "this company"}?`}
        description={
          deleteError ??
          "Nobody is employed here, so nothing is lost. If it was ever used, deactivate it instead — that keeps the record and takes it out of every picker."
        }
        confirmLabel="Remove"
        loading={remove.isPending}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </PageContainer>
  );
}
