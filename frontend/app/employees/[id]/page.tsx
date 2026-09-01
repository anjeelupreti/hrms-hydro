"use client";

import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import ApartmentIcon from "@mui/icons-material/Apartment";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import BadgeIcon from "@mui/icons-material/Badge";
import BlockIcon from "@mui/icons-material/Block";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import ContactPhoneIcon from "@mui/icons-material/ContactPhone";
import DescriptionIcon from "@mui/icons-material/Description";
import EditIcon from "@mui/icons-material/Edit";
import EmailIcon from "@mui/icons-material/Email";
import FolderIcon from "@mui/icons-material/Folder";
import GavelIcon from "@mui/icons-material/Gavel";
import GroupsIcon from "@mui/icons-material/Groups";
import HistoryIcon from "@mui/icons-material/History";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import PaymentsIcon from "@mui/icons-material/Payments";
import PersonIcon from "@mui/icons-material/Person";
import PhoneIcon from "@mui/icons-material/Phone";
import PrintIcon from "@mui/icons-material/Print";
import SchoolIcon from "@mui/icons-material/School";
import SupervisorAccountIcon from "@mui/icons-material/SupervisorAccount";
import TimelineIcon from "@mui/icons-material/Timeline";
import WorkspacePremiumIcon from "@mui/icons-material/WorkspacePremium";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";

import DateText from "@/components/common/DateText";
import StateChip, { EMPLOYMENT_TONE } from "@/components/common/StateChip";
import ActivityFeed from "@/components/employees/ActivityFeed";
import {
  AwardsPanel,
  DisciplinaryPanel,
  SuspensionPanel,
} from "@/components/employees/ConductPanels";
import AtAGlance from "@/components/employees/AtAGlance";
import ChangeRequestPanel from "@/components/employees/ChangeRequestPanel";
import EmployeeFormDialog from "@/components/employees/EmployeeFormDialog";
import EmploymentRecordPanel from "@/components/employees/EmploymentRecordPanel";
import LifecycleEventDialog from "@/components/employees/LifecycleEventDialog";
import OffboardingSummary from "@/components/employees/OffboardingSummary";
import PersonalRecordsPanel from "@/components/employees/PersonalRecordsPanel";
import PositionTimeline from "@/components/employees/PositionTimeline";
import {
  AttendancePanel,
  PayrollPanel,
  TrainingPanel,
} from "@/components/employees/RecordPanels";
import SalaryStructureDialog from "@/components/payroll/SalaryStructureDialog";
import EditProfileDialog from "@/components/profile/EditProfileDialog";
import ExperienceDialog from "@/components/profile/ExperienceDialog";
import NomineesCard from "@/components/profile/NomineesCard";
import RecordOnFile from "@/components/profile/RecordOnFile";
import ProjectMetricsPanel from "@/components/projects/ProjectMetricsPanel";
import Breadcrumbs from "@/components/shell/Breadcrumbs";
import PageContainer from "@/components/shell/PageContainer";
import { useEmployeeDetail, useEmployeeLogs } from "@/hooks/useEmployees";
import { useEmployeeProfile } from "@/hooks/useEmployeeProfile";
import { useCan, useMe } from "@/hooks/useMe";
import { useLifecycleEvents } from "@/hooks/useLifecycle";
import { useMyProfile, type ExperienceKind, type ProfileExperience } from "@/hooks/useProfile";
import { employeeHref } from "@/lib/employeeProfile";

/**
 * **One profile, whoever is looking and wherever they came from.**
 *
 * There used to be three of these. A name in a grid opened a cut-down drawer, a
 * card in the roster came here, and `/profile` was a fourth view of the same
 * record carrying the self-service half. Somebody who reached a colleague from
 * a leave request therefore saw less than somebody who reached them from the
 * roster, with nothing on screen to suggest a fuller view existed — and an
 * employee looking at themselves landed somewhere different again, so "where do
 * I see my payslips" and "where does HR see my payslips" had two answers.
 *
 * Now there is one address (`lib/employeeProfile.ts`) and one page, and what
 * differs is *what it shows*, decided in one place below:
 *
 * | Viewer | Sees |
 * |---|---|
 * | A colleague | Name, post, team, contact — the directory entry |
 * | Themselves | Everything, plus the self-service edits |
 * | `people.manage` | Everything, plus the HR edits |
 *
 * The gate is the capability, not the role, so an HR officer granted
 * `people.manage` reads the same record an admin does. Whether they may
 * *create* or *delete* is a separate question the API answers on its own — see
 * the verb section of `accounts/policy.py` — and not this page's business.
 *
 * **Server-enforced, not merely hidden.** The statutory and bank fields are
 * stripped by `EmployeeDetailSerializer.to_representation` before they reach
 * the browser. Hiding a tab here is a courtesy to the reader; it is not what
 * keeps the data in.
 */

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

function tenureYears(joined: string) {
  const years = (Date.now() - new Date(joined).getTime()) / (365.25 * 24 * 3600 * 1000);
  return Math.max(0, Math.floor(years));
}

/**
 * The tabs — slug, label, icon and who may open one, in a single list.
 *
 * One list drives both the `?tab=` deep link and the rendered tabs. Kept as
 * two, inserting a tab into one and not the other opens the wrong panel for
 * every link below it, silently, because both lists stay valid on their own.
 *
 * `access: "full"` means self or `people.manage`. A colleague gets `overview`
 * and nothing else — a directory entry, which is what a colleague needs.
 */
const TABS = [
  { slug: "overview", label: "Overview", icon: <PersonIcon fontSize="small" />, access: "all" },
  { slug: "record", label: "Record", icon: <BadgeIcon fontSize="small" />, access: "full" },
  { slug: "payroll", label: "Payroll", icon: <AccountBalanceWalletIcon fontSize="small" />, access: "full" },
  { slug: "attendance", label: "Attendance", icon: <CalendarMonthIcon fontSize="small" />, access: "full" },
  { slug: "training", label: "Training", icon: <SchoolIcon fontSize="small" />, access: "full" },
  { slug: "projects", label: "Projects", icon: <FolderIcon fontSize="small" />, access: "full" },
  { slug: "personal", label: "Personal", icon: <ContactPhoneIcon fontSize="small" />, access: "full" },
  { slug: "conduct", label: "Conduct", icon: <GavelIcon fontSize="small" />, access: "full" },
  { slug: "lifecycle", label: "Lifecycle", icon: <TimelineIcon fontSize="small" />, access: "full" },
  { slug: "activity", label: "Activity", icon: <HistoryIcon fontSize="small" />, access: "full" },
] as const;

/**
 * `useSearchParams` needs a Suspense boundary above it in this version of Next,
 * or the whole route opts out of static rendering and the build says so.
 */
export default function EmployeeProfilePage() {
  return (
    <Suspense fallback={<PageContainer><Skeleton variant="rounded" height={260} /></PageContainer>}>
      <ProfileInner />
    </Suspense>
  );
}

function ProfileInner() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();
  const searchParams = useSearchParams();

  const { data: me } = useMe();
  const canManage = useCan("people.manage");
  const isSelf = me?.employee_id != null && me.employee_id === id;
  const seesEverything = isSelf || canManage;

  const { data: p, isLoading } = useEmployeeProfile(id);
  // The employment record, separately: `profile` returns the public-facing half
  // — bio, skills, experience — and this returns the record HR keeps. Whether
  // the statutory part of it comes back is the server's decision.
  const { data: record } = useEmployeeDetail(seesEverything ? id : null);
  const { data: logs } = useEmployeeLogs(seesEverything ? id : null);
  // Only for oneself. `RecordOnFile` and the edit dialog are written against
  // `/accounts/profile`, which is always the caller's own — there is no
  // "somebody else's self-service", and pretending otherwise would show HR
  // their own bank details on a colleague's page.
  const { data: mine } = useMyProfile(isSelf);
  const { data: lifecycle } = useLifecycleEvents(seesEverything ? { employee: id } : {});

  const tabs = TABS.filter((t) => t.access === "all" || seesEverything);
  const requested = (searchParams.get("tab") ?? "").toLowerCase();
  const [tab, setTab] = useState(() => {
    const index = TABS.findIndex((t) => t.slug === requested);
    return index >= 0 ? index : 0;
  });
  // The tab list shrinks once `/me` resolves for a colleague, which can leave
  // `tab` past the end of it.
  const index = Math.min(tab, tabs.length - 1);
  const active = tabs[index]?.slug ?? "overview";

  /**
   * Open a tab by slug — the only way a tab is selected on this page.
   *
   * The open tab goes in the address bar, so a link to somebody's payroll is a
   * link to somebody's payroll. Named, not numeric: `?tab=1` breaks the moment
   * a tab is inserted. The banner above and the tab strip below both come
   * through here, so neither can update the URL in a way the other does not.
   */
  function goToTab(slug: string) {
    const index = tabs.findIndex((t) => t.slug === slug);
    if (index < 0) return;
    setTab(index);
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", slug);
    router.replace(`${employeeHref(id)}?${next.toString()}`, { scroll: false });
  }

  const [editing, setEditing] = useState(false);
  const [editingSelf, setEditingSelf] = useState(false);
  // Which kind of experience is being added, or null. A boolean could not say
  // whether the dialog was opened from "Held here" or "Previous employment",
  // and the dialog needs to know — see `ExperienceDialog`.
  const [addingExp, setAddingExp] = useState<ExperienceKind | null>(null);
  const [salaryOpen, setSalaryOpen] = useState(false);
  const [lifecycleOpen, setLifecycleOpen] = useState(false);

  // Resigned or terminated. The exit summary is only meaningful for somebody on
  // the way out, and showing it otherwise invites "why is this here?".
  const isLeaving = ["resigned", "terminated"].includes(p?.employment_status ?? "");

  if (isLoading || !p) {
    return (
      <PageContainer>
        <Skeleton variant="rounded" height={260} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={320} />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <Breadcrumbs />
      {!isSelf && (
        <Button component={Link} href="/employees" startIcon={<ArrowBackIcon />} size="small" sx={{ mb: 2 }}>
          Employees
        </Button>
      )}

      {/* Above the record, not inside a tab. Somebody opening a colleague's
          profile to ask them something needs to know they are locked out
          before they read anything else, and a chip alone cannot say until
          when. Only where the server sent one — a colleague is not told. */}
      {record?.active_suspension ? (
        <Alert
          severity="warning"
          icon={<BlockIcon />}
          sx={{ mb: 2 }}
          action={
            canManage ? (
              <Button size="small" onClick={() => goToTab("conduct")}>
                Manage
              </Button>
            ) : null
          }
        >
          <strong>Suspended</strong> since{" "}
          <DateText value={record.active_suspension.starts_on} />
          {record.active_suspension.ends_on ? (
            <>
              , until <DateText value={record.active_suspension.ends_on} />
            </>
          ) : (
            " — until further notice"
          )}
          . They cannot sign in. {record.active_suspension.reason}
        </Alert>
      ) : null}

      <Card sx={{ mb: 2, overflow: "hidden" }}>
        <Box
          sx={{
            height: 150,
            background: p.cover_image
              ? `url(${p.cover_image}) ${p.cover_position ?? "50% 50%"}/cover`
              : "var(--hrms-gradient-profile)",
          }}
        />
        <CardContent sx={{ pt: 0 }}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={2}
            sx={{ alignItems: { md: "flex-end" }, mt: -6 }}
          >
            <Avatar
              src={p.photo ?? undefined}
              sx={{
                width: 108,
                height: 108,
                fontSize: 34,
                border: "4px solid",
                borderColor: "background.paper",
                bgcolor: "primary.light",
                color: "primary.dark",
              }}
            >
              {initials(p.full_name)}
            </Avatar>
            <Box sx={{ flex: 1, pb: 0.5, minWidth: 0 }}>
              <Typography variant="h5">{p.full_name}</Typography>
              <Typography variant="body2" color="text.secondary">
                {p.designation_title ?? "—"}
                {p.department_name ? ` · ${p.department_name}` : ""}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap" }} useFlexGap>
                <Chip size="small" icon={<BadgeIcon />} label={p.employee_code} />
                <StateChip
                  label={p.employment_status.replace("_", " ")}
                  tone={EMPLOYMENT_TONE[p.employment_status] ?? "muted"}
                />
                {/* Which company employs them. On a group running several
                    project companies this is not decoration — it is the answer
                    to whose payroll they are on, and the secondaries are where
                    else they actually work. */}
                {record?.primary_company_name ? (
                  <Chip
                    size="small"
                    variant="outlined"
                    icon={<ApartmentIcon />}
                    label={record.primary_company_name}
                  />
                ) : null}
                {(record?.secondary_company_names ?? []).map((name) => (
                  <Chip key={name} size="small" variant="outlined" label={`also ${name}`} />
                ))}
                {/* The chair and the work. Two chips because they are two
                    facts — see `Employee.corporate_post`. */}
                {record?.corporate_post_name ? (
                  <Chip size="small" variant="outlined" label={record.corporate_post_name} />
                ) : null}
                {record?.corporate_role_name ? (
                  <Chip size="small" variant="outlined" label={record.corporate_role_name} />
                ) : null}
              </Stack>
            </Box>
            {isSelf ? (
              <Stack direction="row" spacing={3} sx={{ pb: 1 }}>
                <Stat value={`${tenureYears(p.date_joined)}+ yr`} label="Tenure" />
                <Stat value={String((p.experiences ?? []).length)} label="Experience" />
                <Stat value={String((p.skills ?? []).length)} label="Skills" />
              </Stack>
            ) : null}
            <Stack
              direction="row"
              spacing={1}
              className="no-print"
              sx={{ pb: 0.5, flexWrap: "wrap", rowGap: 1 }}
              useFlexGap
            >
              {!isSelf && (
                <Button variant="outlined" startIcon={<EmailIcon />} href={`mailto:${p.email}`}>
                  Contact
                </Button>
              )}
              {isSelf && mine?.resume ? (
                <Button
                  component="a"
                  href="/api/proxy/accounts/profile/resume"
                  target="_blank"
                  rel="noopener"
                  startIcon={<DescriptionIcon />}
                >
                  CV
                </Button>
              ) : null}
              {isSelf && (
                <Button startIcon={<PrintIcon />} onClick={() => window.print()}>
                  Print
                </Button>
              )}
              {canManage && (
                <>
                  <Button startIcon={<PaymentsIcon />} onClick={() => setSalaryOpen(true)}>
                    Salary
                  </Button>
                  <Button startIcon={<TimelineIcon />} onClick={() => setLifecycleOpen(true)}>
                    Lifecycle
                  </Button>
                </>
              )}
              {/* Editing yourself and editing somebody else are different forms
                  against different endpoints — the self-service subset versus
                  the HR record. One button either way, because from the
                  reader's side there is one thing being edited. */}
              {isSelf ? (
                <Button variant="contained" startIcon={<EditIcon />} onClick={() => setEditingSelf(true)}>
                  Edit
                </Button>
              ) : canManage ? (
                <Button variant="contained" startIcon={<EditIcon />} onClick={() => setEditing(true)}>
                  Edit
                </Button>
              ) : null}
            </Stack>
          </Stack>
          {p.bio && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2, maxWidth: 900 }}>
              {p.bio}
            </Typography>
          )}
        </CardContent>
      </Card>

      <Tabs
        value={index}
        onChange={(_e, value: number) => goToTab(tabs[value].slug)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 2 }}
      >
        {tabs.map((t) => (
          <Tab key={t.slug} icon={t.icon} iconPosition="start" label={t.label} />
        ))}
      </Tabs>

      {active === "overview" ? (
        <>
          {seesEverything ? <AtAGlance employeeId={id} mine={isSelf} /> : null}
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 5 }}>
              <Card sx={{ mb: 2 }}>
                <CardContent>
                  <Typography variant="overline" color="text.secondary">
                    About
                  </Typography>
                  <Stack spacing={1.5} sx={{ mt: 1, color: "text.secondary" }}>
                    <Row icon={<EmailIcon fontSize="small" />} value={p.email} />
                    <Row icon={<PhoneIcon fontSize="small" />} value={p.phone || "—"} />
                    <Row
                      icon={<LocationOnIcon fontSize="small" />}
                      value={[p.address, p.city, p.country].filter(Boolean).join(", ") || "—"}
                    />
                    <Row
                      icon={<SupervisorAccountIcon fontSize="small" />}
                      value={
                        p.manager_name && p.manager_id != null ? (
                          <Link href={employeeHref(p.manager_id)} style={{ color: "inherit" }}>
                            {p.manager_name}
                          </Link>
                        ) : (
                          "No manager"
                        )
                      }
                    />
                  </Stack>
                </CardContent>
              </Card>
              <Card>
                <CardContent>
                  <Typography variant="overline" color="text.secondary">
                    Skills
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap" }} useFlexGap>
                    {p.skills.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        No skills listed.
                      </Typography>
                    ) : (
                      p.skills.map((s) => <Chip key={s} label={s} variant="outlined" color="primary" />)
                    )}
                  </Stack>
                </CardContent>
              </Card>
            </Grid>

            <Grid size={{ xs: 12, md: 7 }}>
              {/* Their career *here*, above the jobs they had before it. The
                  lifecycle tab lists the field changes that produced this — an
                  audit trail answering "what was edited". Nobody asks that;
                  they ask how long somebody has been doing this job, which is a
                  span rather than an event. */}
              {seesEverything ? (
                <PositionTimeline
                  logs={logs}
                  dateJoined={p.date_joined}
                  currentTitle={p.designation_title ?? "—"}
                  department={p.department_name}
                />
              ) : null}
              {/* ── Two sections, near each other and not merged ────────
                  A post held here and a job somewhere before are the same six
                  facts with different provenance: one is what this company
                  knows first-hand and wrote itself, the other is what somebody
                  told us at interview. Running them together makes a career
                  history in which the reader cannot tell which half the
                  company can actually vouch for. */}
              <ExperienceSection
                title="Held here"
                caption="Posts inside this company."
                experiences={p.experiences.filter((e) => e.kind === "internal")}
                emptyText="No internal posts recorded."
                onAdd={isSelf || canManage ? () => setAddingExp("internal") : undefined}
              />
              <ExperienceSection
                title="Previous employment"
                caption="Before joining. Self-declared until HR verifies it."
                experiences={p.experiences.filter((e) => e.kind !== "internal")}
                emptyText="No previous employment listed."
                onAdd={isSelf ? () => setAddingExp("previous") : undefined}
                showVerification
              />
              <Card>
                <CardContent>
                  <Typography variant="overline" color="text.secondary">
                    Team
                  </Typography>
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mt: 1 }}>
                    <Avatar sx={{ bgcolor: "secondary.main" }}>
                      <GroupsIcon />
                    </Avatar>
                    <Box>
                      <Typography variant="subtitle2">{p.department_name ?? "Unassigned"}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        Joined <DateText value={p.date_joined} />
                      </Typography>
                    </Box>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </>
      ) : null}

      {active === "record" && record ? <EmploymentRecordPanel employee={record} /> : null}
      {active === "payroll" ? <PayrollPanel employeeId={id} mine={isSelf} /> : null}
      {/* Clock history lives inside this panel — the punches, the day's
          fulfilment and the month's summary, which is where somebody looks for
          them rather than in a tab of their own. */}
      {active === "attendance" ? <AttendancePanel employeeId={id} mine={isSelf} /> : null}
      {active === "training" ? <TrainingPanel employeeId={id} mine={isSelf} /> : null}
      {active === "projects" ? <ProjectMetricsPanel employeeId={id} /> : null}

      {active === "personal" ? (
        <Stack spacing={3}>
          {/* The record the company holds *about* them — bank, statutory
              numbers, legal identity. Only for oneself: it is served by the
              self-service endpoint, and HR reads the same facts on Record. */}
          {isSelf && mine ? <RecordOnFile profile={mine} /> : null}
          <NomineesCard employeeId={id} />
          <PersonalRecordsPanel employeeId={id} />
          {/* Beside the records they are about — noticing a wrong account
              number in one place and having to ask for it to be fixed in
              another is how a correction never gets made. */}
          <ChangeRequestPanel employeeId={id} />
        </Stack>
      ) : null}

      {active === "conduct" ? (
        <Stack spacing={3}>
          {/* Read at the same moment — an appraisal, a promotion decision, an
              exit — but kept as three lists. One chronological stream would
              put a long-service award next to a written warning with nothing
              but an icon to tell them apart. */}
          <SuspensionPanel employeeId={id} />
          <AwardsPanel employeeId={id} />
          <DisciplinaryPanel employeeId={id} />
        </Stack>
      ) : null}

      {active === "lifecycle" ? (
        <Stack spacing={2}>
          {isLeaving ? (
            <Card>
              <CardContent>
                <Typography variant="overline" color="text.secondary">
                  Outstanding on the way out
                </Typography>
                <Box sx={{ mt: 1.5 }}>
                  <OffboardingSummary employeeId={id} />
                </Box>
              </CardContent>
            </Card>
          ) : null}
          <PositionTimeline
            logs={logs}
            dateJoined={p.date_joined}
            currentTitle={p.designation_title ?? "—"}
            department={p.department_name}
          />

          {/* The workflow half, which had no home at all. `PositionTimeline`
              draws the spans and `Record history` lists field changes; neither
              shows the *events* that produced them, so a promotion awaiting
              approval was invisible on the record it was about. */}
          <Card>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                Lifecycle events
              </Typography>
              {(lifecycle?.results ?? []).length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
                  No promotions, transfers or exits have been raised.
                </Typography>
              ) : (
                <Stack spacing={1.5} sx={{ mt: 1 }} divider={<Divider flexItem />}>
                  {(lifecycle?.results ?? []).map((event) => (
                    <Stack
                      key={event.id}
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: "baseline", flexWrap: "wrap" }}
                    >
                      <Chip
                        size="small"
                        label={event.event_type.replace("_", " ")}
                        sx={{ textTransform: "capitalize" }}
                      />
                      <StateChip
                        label={event.status.replace("_", " ")}
                        tone={LIFECYCLE_TONE[event.status] ?? "muted"}
                      />
                      <Typography variant="body2" color="text.secondary">
                        {[
                          event.new_designation_title,
                          event.new_department_name,
                          event.award_title,
                        ]
                          .filter(Boolean)
                          .join(" · ") || event.reason}
                      </Typography>
                      <Box sx={{ flex: 1 }} />
                      <Typography variant="caption" color="text.secondary">
                        effective <DateText value={event.effective_date} />
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                Record history
              </Typography>
              {(logs ?? []).length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
                  Nothing has changed since this record was created.
                </Typography>
              ) : (
                <Stack spacing={1} sx={{ mt: 1 }} divider={<Divider flexItem />}>
                  {(logs ?? []).map((entry) => (
                    <Stack
                      key={entry.id}
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: "baseline", flexWrap: "wrap" }}
                    >
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {entry.field.replace("_", " ")}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {entry.from_value || "nothing"} → {entry.to_value || "nothing"}
                      </Typography>
                      <Box sx={{ flex: 1 }} />
                      <Typography variant="caption" color="text.secondary">
                        {entry.actor_name ?? "System"} · <DateText value={entry.created_at} />
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Stack>
      ) : null}

      {active === "activity" ? <ActivityFeed employeeId={id} mine={isSelf} /> : null}

      {/* Mounted on the capability rather than on the open flag, so a dialog
          already open cannot be unmounted mid-edit by a refetch. */}
      {canManage ? (
        <>
          <EmployeeFormDialog open={editing} onClose={() => setEditing(false)} employeeId={id} />
          <SalaryStructureDialog
            open={salaryOpen}
            onClose={() => setSalaryOpen(false)}
            employeeId={id}
            employeeName={p.full_name}
          />
          <LifecycleEventDialog
            open={lifecycleOpen}
            onClose={() => setLifecycleOpen(false)}
            employeeId={id}
            employeeName={p.full_name}
          />
        </>
      ) : null}
      {editingSelf && mine ? (
        <EditProfileDialog profile={mine} onClose={() => setEditingSelf(false)} />
      ) : null}
      {addingExp ? (
        <ExperienceDialog kind={addingExp} onClose={() => setAddingExp(null)} />
      ) : null}
    </PageContainer>
  );
}

function Row({ icon, value }: { icon: ReactNode; value: ReactNode }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
      {icon}
      <Typography variant="body2" color="text.primary" sx={{ wordBreak: "break-word" }}>
        {value}
      </Typography>
    </Stack>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <Box sx={{ textAlign: "center" }}>
      <Typography variant="h6" sx={{ fontWeight: 800 }}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );
}


/**
 * The tone for a lifecycle event's status. Beside the component that reads it
 * rather than in `StateChip`, because these five states belong to one workflow
 * and nothing else on the page uses them.
 */
const LIFECYCLE_TONE: Record<string, "normal" | "caution" | "alarm" | "muted"> = {
  pending_approval: "caution",
  approved: "normal",
  applied: "normal",
  rejected: "alarm",
  cancelled: "muted",
};

/**
 * One block of work history.
 *
 * Rendered twice — once for posts held here and once for previous employment —
 * so the two read as related without being merged. `showVerification` is only
 * meaningful on the second: an internal post is a fact this system wrote
 * itself, and a "verified" tick on it would be the company vouching for its
 * own database.
 */
function ExperienceSection({
  title,
  caption,
  experiences,
  emptyText,
  onAdd,
  showVerification = false,
}: {
  title: string;
  caption: string;
  experiences: ProfileExperience[];
  emptyText: string;
  onAdd?: () => void;
  showVerification?: boolean;
}) {
  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Stack direction="row" sx={{ alignItems: "flex-start", justifyContent: "space-between" }}>
          <Box>
            <Typography variant="overline" color="text.secondary">
              {title}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: -0.5 }}>
              {caption}
            </Typography>
          </Box>
          {onAdd ? (
            <Button size="small" onClick={onAdd}>
              Add
            </Button>
          ) : null}
        </Stack>
        {experiences.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            {emptyText}
          </Typography>
        ) : (
          <Stack spacing={2} sx={{ mt: 1.5 }} divider={<Divider flexItem />}>
            {experiences.map((exp) => (
              <Stack key={exp.id} direction="row" spacing={1.5} sx={{ alignItems: "flex-start" }}>
                <Avatar
                  variant="rounded"
                  sx={{
                    bgcolor: "transparent",
                    color: "primary.main",
                    border: "1.5px solid",
                    borderColor: "primary.main",
                    width: 40,
                    height: 40,
                  }}
                >
                  <WorkspacePremiumIcon fontSize="small" />
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                    <Typography variant="subtitle2">{exp.title}</Typography>
                    {showVerification && exp.is_verified ? (
                      <Chip size="small" variant="outlined" color="success" label="Verified" />
                    ) : null}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {exp.company}
                    {exp.start_year ? ` · ${exp.start_year} – ${exp.end_year ?? "Present"}` : ""}
                  </Typography>
                  {exp.description && (
                    <Typography variant="body2" sx={{ mt: 0.5 }}>
                      {exp.description}
                    </Typography>
                  )}
                </Box>
              </Stack>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
