"use client";

import AddIcon from "@mui/icons-material/Add";
import ApartmentIcon from "@mui/icons-material/Apartment";
import PaymentsIcon from "@mui/icons-material/Payments";
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
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useState } from "react";

import ConfirmDialog from "@/components/common/ConfirmDialog";
import ViewSwitch, { useViewMode } from "@/components/common/ViewSwitch";
import EmptyState from "@/components/common/EmptyState";
import ListControls from "@/components/common/ListControls";
import CompanyDetailDialog from "@/components/companies/CompanyDetailDialog";
import CompanyFormDialog from "@/components/companies/CompanyFormDialog";
import Breadcrumbs from "@/components/shell/Breadcrumbs";
import PageContainer from "@/components/shell/PageContainer";
import { useCompanies, useDeleteCompany } from "@/hooks/useCompanies";
import { useCan, useCanCreate, useCanDelete } from "@/hooks/useMe";
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
  const canManage = useCan("settings.manage");
  // Creating and deleting are the admin's; an officer may keep the details
  // current. The API enforces this independently — these only stop the page
  // offering a button that would come back 403.
  const canCreate = useCanCreate("settings.manage");
  const canDelete = useCanDelete("settings.manage");

  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Company | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<Company | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Company | null>(null);
  const { mode: view, setMode: setView } = useViewMode("companies", "cards");

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
        {canCreate ? (
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            Add company
          </Button>
        ) : null}
      </Stack>

      <ListControls
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Name, code, registration or river…"
        searchLabel="Search companies by name, code, registration number or river"
        trailing={<ViewSwitch value={view} onChange={setView} modes={["cards", "list"]} />}
      />

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
      ) : view === "list" ? (
        <Card>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Code</TableCell>
                  <TableCell>Company</TableCell>
                  <TableCell>Kind</TableCell>
                  <TableCell>Stage</TableCell>
                  <TableCell align="right">Capacity</TableCell>
                  <TableCell>Where</TableCell>
                  <TableCell align="right">On payroll</TableCell>
                  {canManage ? <TableCell /> : null}
                </TableRow>
              </TableHead>
              <TableBody>
                {companies.map((company) => (
                  <TableRow
                    key={company.id}
                    hover
                    sx={{ cursor: "pointer", opacity: company.is_active ? 1 : 0.55 }}
                    onClick={() => setViewing(company)}
                  >
                    <TableCell sx={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                      {company.code}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {company.name}
                      </Typography>
                      {company.parent_name ? (
                        <Typography variant="caption" color="text.secondary">
                          under {company.parent_name}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Chip size="small" variant="outlined" label={company.kind_display} />
                      {company.is_primary ? (
                        <Chip
                          size="small"
                          color="primary"
                          label="Payroll"
                          sx={{ ml: 0.5 }}
                        />
                      ) : null}
                    </TableCell>
                    <TableCell sx={{ color: "text.secondary" }}>
                      {company.project_stage === "na" ? "—" : company.project_stage_display}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                      {capacity(company) || "—"}
                    </TableCell>
                    <TableCell sx={{ color: "text.secondary" }}>
                      {[company.district, company.province].filter(Boolean).join(", ") || "—"}
                    </TableCell>
                    <TableCell align="right">{company.employee_count}</TableCell>
                    {canManage ? (
                      <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                        <Tooltip title="Edit">
                          <IconButton
                            size="small"
                            onClick={(event) => {
                              event.stopPropagation();
                              openEdit(company);
                            }}
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {canDelete ? (
                          <Tooltip
                            title={
                              company.employee_count > 0
                                ? "Somebody is on this payroll — deactivate it instead"
                                : "Remove"
                            }
                          >
                            <span>
                              <IconButton
                                size="small"
                                disabled={company.employee_count > 0}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setDeleteError(null);
                                  setDeleting(company);
                                }}
                              >
                                <DeleteOutlineIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      ) : (
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
          {companies.map((company) => (
            <Card
              key={company.id}
              sx={{
                opacity: company.is_active ? 1 : 0.6,
                cursor: "pointer",
                transition: "box-shadow .2s",
                "&:hover": { boxShadow: 4 },
              }}
              // The card opens the company. The edit and delete buttons inside
              // it stop the event, so the two do not fight: clicking a card
              // reads, clicking a button acts.
              onClick={() => setViewing(company)}
            >
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
                        <IconButton
                          size="small"
                          onClick={(event) => {
                            event.stopPropagation();
                            openEdit(company);
                          }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {canDelete ? (
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
                              onClick={(event) => {
                                event.stopPropagation();
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
                  {company.is_primary ? (
                    <Chip
                      size="small"
                      color="primary"
                      icon={<PaymentsIcon />}
                      label="Payroll entity"
                    />
                  ) : null}
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
                      onClick={(event: React.MouseEvent) => event.stopPropagation()}
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

      <CompanyDetailDialog
        company={viewing}
        onClose={() => setViewing(null)}
        // Only offered to somebody who may act on it. Handing an Edit button to
        // a reader who will be refused is worse than not offering one.
        onEdit={
          canManage
            ? (company) => {
                setViewing(null);
                openEdit(company);
              }
            : undefined
        }
      />

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
