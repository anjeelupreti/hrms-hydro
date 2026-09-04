"use client";

import AddIcon from "@mui/icons-material/Add";
import EventNoteIcon from "@mui/icons-material/EventNote";
import PlaceIcon from "@mui/icons-material/Place";
import ScheduleIcon from "@mui/icons-material/Schedule";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Grid from "@mui/material/Grid";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMemo, useState } from "react";

import CountFilterBar from "@/components/common/CountFilterBar";
import DateField from "@/components/common/DateField";
import DateText from "@/components/common/DateText";
import EmptyState from "@/components/common/EmptyState";
import ListControls from "@/components/common/ListControls";
import ListPagination from "@/components/common/ListPagination";
import StateChip from "@/components/common/StateChip";
import { CompanyPicker, EmployeePicker, ProjectPicker } from "@/components/common/pickers";
import FieldVisitDialog from "@/components/fieldvisits/FieldVisitDialog";
import Breadcrumbs from "@/components/shell/Breadcrumbs";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import {
  VISIT_PURPOSES,
  VISIT_STATUS_TONE,
  useFieldVisitStatusCounts,
  useFieldVisits,
  useSaveFieldVisit,
  type FieldVisit,
  type FieldVisitFormValues,
  type VisitPurpose,
} from "@/hooks/useFieldVisits";
import { useMe } from "@/hooks/useMe";
import { useEligibleApprovers, useSites } from "@/hooks/useSites";
import { withCode } from "@/lib/people";

/**
 * Field visits — going to site, and what came of it.
 *
 * **Not timesheets.** A time entry is *hours against a project on a day*,
 * recorded after the fact and approved in bulk. A visit is a journey: it has a
 * destination, a purpose, companions, a cost, and a travel order that has to be
 * approved **before** anybody sets off — then a report afterwards, which is the
 * thing the visit existed to produce. Folding that into a time entry means
 * either a time entry that can be approved in advance or four more nullable
 * columns on the busiest table in the product. The argument in full is in
 * `backend/fieldvisits/models.py`.
 *
 * What the two genuinely share is generated rather than duplicated: a completed
 * visit turns into timesheet lines on request, and an approved one keeps the
 * traveller off the absentee list.
 */

const TODAY = () => new Date().toISOString().slice(0, 10);

const EMPTY: FieldVisitFormValues = {
  company: null,
  project: null,
  purpose: "inspection",
  title: "",
  site: null,
  destination: "",
  district: "",
  starts_on: TODAY(),
  ends_on: TODAY(),
  description: "",
  transport: "",
  estimated_cost: "",
  approver: null,
};

export default function FieldVisitsPage() {
  const { data: me } = useMe();
  const { data: sites } = useSites({ active: true });

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [purpose, setPurpose] = useState("");
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [values, setValues] = useState<FieldVisitFormValues>(EMPTY);
  // Asked for the *chosen* site, because a site brings its own supervisors
  // into who may approve the trip. Declared after `values` for that reason.
  const { data: approvers } = useEligibleApprovers(values.site);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useFieldVisits({
    search: search || undefined,
    status: status || undefined,
    purpose: purpose || undefined,
    mine,
  });
  // Counted over the same rows the list is drawn from, so a chip cannot
  // disagree with what is underneath it.
  const counts = useFieldVisitStatusCounts({ mine });
  const save = useSaveFieldVisit();

  const rows = useMemo(() => data?.results ?? [], [data]);
  const paged = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize]
  );
  const open = rows.find((visit) => visit.id === openId) ?? null;

  async function create() {
    setError(null);
    try {
      const made = await save.mutateAsync({ values });
      setCreating(false);
      setValues(EMPTY);
      setOpenId(made.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That visit could not be saved.");
    }
  }

  return (
    <PageContainer>
      <Breadcrumbs />
      <PageHeader
        title="Field visits"
        subtitle="Travel orders for site work — approved before departure, reported on return"
        icon={<PlaceIcon />}
        actions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setValues({ ...EMPTY, starts_on: TODAY(), ends_on: TODAY() });
              setCreating(true);
            }}
          >
            New visit
          </Button>
        }
      />

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      <ListControls
        search={search}
        onSearchChange={(next) => {
          setSearch(next);
          setPage(1);
        }}
        searchPlaceholder="Search visits…"
        searchLabel="Search field visits by title, destination or district"
        filters={
          <>
            <TextField
              select
              size="small"
              label="Purpose"
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="">All</MenuItem>
              {VISIT_PURPOSES.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Whose"
              value={mine ? "mine" : "all"}
              onChange={(event) => setMine(event.target.value === "mine")}
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="all">Everyone</MenuItem>
              <MenuItem value="mine">Mine</MenuItem>
            </TextField>
          </>
        }
        chips={
          <CountFilterBar
            ariaLabel="Filter field visits by status"
            value={status}
            onChange={(next) => {
              setStatus(next);
              setPage(1);
            }}
            loading={isLoading}
            options={[
              { value: "", label: "All", count: counts.total },
              { value: "draft", label: "Draft", count: counts.draft },
              {
                value: "requested",
                label: "Awaiting approval",
                count: counts.requested,
                tone: "warning",
              },
              { value: "approved", label: "Approved", count: counts.approved, tone: "success" },
              { value: "completed", label: "Completed", count: counts.completed, tone: "info" },
              { value: "rejected", label: "Rejected", count: counts.rejected, tone: "danger" },
            ]}
          />
        }
      />

      {isLoading ? (
        <Stack spacing={1.5}>
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} variant="rounded" height={92} />
          ))}
        </Stack>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No field visits"
          description="A travel order records where somebody is going, why, and who approved it — then carries the report back."
        />
      ) : (
        <Stack spacing={1.5}>
          {paged.map((visit) => (
            <VisitCard key={visit.id} visit={visit} onOpen={() => setOpenId(visit.id)} />
          ))}
        </Stack>
      )}

      <ListPagination
        page={page}
        pageSize={pageSize}
        count={rows.length}
        noun="visits"
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />

      <FieldVisitDialog visit={open} onClose={() => setOpenId(null)} />

      <Dialog open={creating} onClose={() => setCreating(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New field visit</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12 }}>
              <TextField
                label="What the visit is for"
                fullWidth
                required
                autoFocus
                value={values.title}
                onChange={(event) => setValues({ ...values, title: event.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 7 }}>
              <TextField
                label="Destination"
                fullWidth
                required
                value={values.destination}
                onChange={(event) => setValues({ ...values, destination: event.target.value })}
                helperText="The site or place — “Headworks, Sanjen Khola”."
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 5 }}>
              <TextField
                label="District"
                fullWidth
                value={values.district}
                onChange={(event) => setValues({ ...values, district: event.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                select
                label="Purpose"
                fullWidth
                value={values.purpose}
                onChange={(event) =>
                  setValues({ ...values, purpose: event.target.value as VisitPurpose })
                }
              >
                {VISIT_PURPOSES.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <CompanyPicker
                label="Company"
                value={values.company}
                onChange={(id) => setValues({ ...values, company: id })}
                size="small"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <DateField
                label="From"
                value={values.starts_on}
                onChange={(value) => setValues({ ...values, starts_on: value ?? "" })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <DateField
                label="To"
                value={values.ends_on}
                onChange={(value) => setValues({ ...values, ends_on: value ?? "" })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <ProjectPicker
                label="Project"
                value={values.project}
                onChange={(id) => setValues({ ...values, project: id })}
                size="small"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              {/* Optional. A visit still goes to "the headrace tunnel, ch.
                  1400" as often as to a named installation — what naming a
                  site buys is its supervisors joining the people who may
                  approve the trip. */}
              <TextField
                select
                label="Site"
                fullWidth
                size="small"
                value={values.site ?? ""}
                onChange={(event) =>
                  setValues({
                    ...values,
                    site: event.target.value === "" ? null : Number(event.target.value),
                    // The eligible approvers change with the site, so a name
                    // chosen against the old one may no longer be allowed.
                    // Cleared rather than left to be refused on submit.
                    approver: null,
                  })
                }
                helperText="Optional — its supervisors can approve the trip."
              >
                <MenuItem value="">Not a listed site</MenuItem>
                {(sites?.results ?? []).map((site) => (
                  <MenuItem key={site.id} value={site.id}>
                    {site.name}
                    {site.code ? ` (${site.code})` : ""}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              {/* **Not a free employee picker.** It was one, and the API now
                  refuses anybody who is neither the traveller's supervisor nor
                  one of the site's — so the form was offering names that would
                  be rejected on submit. The list comes from the server, which
                  is the same function the submit validates against. */}
              <TextField
                select
                required
                label="Approver"
                fullWidth
                size="small"
                value={values.approver ?? ""}
                onChange={(event) =>
                  setValues({
                    ...values,
                    approver: event.target.value === "" ? null : Number(event.target.value),
                  })
                }
                error={approvers !== undefined && approvers.length === 0}
                helperText={
                  approvers !== undefined && approvers.length === 0
                    ? "Nobody can approve this trip. Ask HR for a supervisor, or add supervisors to the site."
                    : "Your supervisors, plus the site's."
                }
              >
                {(approvers ?? []).map((person) => (
                  <MenuItem key={person.id} value={person.id}>
                    {withCode(person.name, person.employee_code)}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Transport"
                fullWidth
                value={values.transport}
                onChange={(event) => setValues({ ...values, transport: event.target.value })}
                helperText="Office vehicle, bus, hired jeep…"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Estimated cost"
                fullWidth
                value={values.estimated_cost}
                onChange={(event) => setValues({ ...values, estimated_cost: event.target.value })}
                helperText="What the advance should cover. Optional."
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                label="Details"
                fullWidth
                multiline
                minRows={3}
                value={values.description}
                onChange={(event) => setValues({ ...values, description: event.target.value })}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreating(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={create}
            disabled={save.isPending || !values.title.trim() || !values.destination.trim()}
          >
            Save as draft
          </Button>
        </DialogActions>
      </Dialog>
    </PageContainer>
  );
}

function VisitCard({ visit, onOpen }: { visit: FieldVisit; onOpen: () => void }) {
  return (
    <Card>
      <CardActionArea onClick={onOpen}>
        <CardContent sx={{ py: 1.5 }}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "baseline", flexWrap: "wrap" }}
            useFlexGap
          >
            <Typography sx={{ fontWeight: 700 }}>{visit.title}</Typography>
            <StateChip
              label={visit.status_display}
              tone={VISIT_STATUS_TONE[visit.status] ?? "muted"}
            />
            <Chip size="small" variant="outlined" label={visit.purpose_display} />
          </Stack>
          <Stack
            direction="row"
            spacing={1.5}
            sx={{ mt: 0.5, color: "text.secondary", flexWrap: "wrap" }}
            useFlexGap
          >
            <Typography variant="caption" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <PlaceIcon sx={{ fontSize: 14 }} />
              {[visit.destination, visit.district].filter(Boolean).join(", ")}
            </Typography>
            <Typography variant="caption" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <ScheduleIcon sx={{ fontSize: 14 }} />
              <DateText value={visit.starts_on} /> – <DateText value={visit.ends_on} />
              {` · ${visit.days} day${visit.days === 1 ? "" : "s"}`}
            </Typography>
            <Typography variant="caption">{visit.employee_name}</Typography>
            {visit.project_name ? (
              <Typography variant="caption" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <EventNoteIcon sx={{ fontSize: 14 }} />
                {visit.project_name}
              </Typography>
            ) : null}
            {visit.attachments.length > 0 ? (
              <Typography variant="caption">
                {visit.attachments.length} attachment(s)
              </Typography>
            ) : null}
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
