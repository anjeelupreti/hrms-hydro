import type { SvgIconComponent } from "@mui/icons-material";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import ApartmentIcon from "@mui/icons-material/Apartment";
import AssessmentIcon from "@mui/icons-material/Assessment";
import CampaignIcon from "@mui/icons-material/Campaign";
import BeachAccessIcon from "@mui/icons-material/BeachAccess";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import ChecklistIcon from "@mui/icons-material/Checklist";
import DevicesIcon from "@mui/icons-material/Devices";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import EventIcon from "@mui/icons-material/Event";
import FlagIcon from "@mui/icons-material/Flag";
import FolderIcon from "@mui/icons-material/Folder";
import HandshakeIcon from "@mui/icons-material/Handshake";
import HomeWorkIcon from "@mui/icons-material/HomeWork";
import PaymentsIcon from "@mui/icons-material/Payments";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import ManageAccountsIcon from "@mui/icons-material/ManageAccounts";
import PeopleIcon from "@mui/icons-material/People";
import PersonSearchIcon from "@mui/icons-material/PersonSearch";
import PollIcon from "@mui/icons-material/Poll";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import ReviewsIcon from "@mui/icons-material/Reviews";
import ScheduleIcon from "@mui/icons-material/Schedule";
import SchoolIcon from "@mui/icons-material/School";
import PersonIcon from "@mui/icons-material/Person";
import SpaceDashboardIcon from "@mui/icons-material/SpaceDashboard";
import ConfirmationNumberIcon from "@mui/icons-material/ConfirmationNumber";
import SupportAgentIcon from "@mui/icons-material/SupportAgent";

import type { ModuleKey } from "@/lib/theme/tokens";

/**
 * The one navigation model.
 *
 * The sidebar, the breadcrumb trail and the ⌘K palette all read from here, so
 * a route can never be reachable from one and invisible to another. Two
 * surfaces keeping their own lists is two lists that drift.
 *
 * `module` picks the hue from the design tokens. It is deliberately not the
 * accent colour: the accent is a personal preference and may be any hue, so
 * navigation cannot depend on it.
 */

export type NavItem = {
  href: string;
  label: string;
  icon: SvgIconComponent;
  module: ModuleKey;
  /**
   * The capability this row needs. Omit for rows every employee has — their
   * own leave, their own payslips, chat.
   *
   * **Replaces `hrOnly`,** which was a single boolean applied to exactly one
   * item. Everything else was shown to everybody and led to a 403 wall, so the
   * product did not look secure, it looked broken. The names match
   * `accounts/policy.py` exactly; the server sends the list and the browser
   * never infers it from a role.
   */
  permission?: string;
  /** Extra words the command palette should match on, beyond the label. */
  keywords?: string[];
  /** Which live counter, if any, badges this row. */
  badge?: "mailUnread";
};

export type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "overview",
    label: "Overview",
    items: [
      {
        // The in-app dashboard is /dashboard — `/` is the public marketing
        // page, which `proxy.ts` redirects away from once you are signed in.
        // Pointing this at `/` cost a redirect hop, never highlighted, and
        // produced a "Dashboard › Dashboard" breadcrumb.
        href: "/dashboard",
        permission: "dashboard.view",
        label: "Dashboard",
        icon: SpaceDashboardIcon,
        module: "dashboard",
        keywords: ["home", "overview", "start"],
      },
      {
        // The employee's own view of everything about them. Sits beside the
        // dashboard rather than under People, because People is the HR view of
        // *others* and this is the one page that is about you.
        href: "/portal",
        label: "My workspace",
        icon: PersonIcon,
        module: "dashboard",
        keywords: ["me", "my", "self service", "portal", "my leave", "my pay", "my attendance"],
      },
      {
        href: "/calendar",
        label: "Calendar",
        icon: CalendarMonthIcon,
        module: "collaboration",
        keywords: ["events", "holidays", "schedule"],
      },
      {
        // Beside the calendar without being it. A calendar answers "what else
        // is on that day"; this answers "what has this company done, and what
        // is coming" — which is read as a timeline, not a grid.
        href: "/events",
        permission: "workplace.manage",
        label: "Events",
        icon: EventIcon,
        module: "collaboration",
        keywords: [
          "event", "events", "board meeting", "agm", "ceremony", "drill",
          "inspection", "audit", "public hearing", "stakeholders", "minutes",
        ],
      },
      {
        href: "/meetings",
        label: "Meetings",
        icon: EventIcon,
        module: "collaboration",
        keywords: ["1:1", "rsvp", "invite", "agenda"],
      },
    ],
  },
  {
    id: "people",
    label: "People",
    items: [
      {
        href: "/employees",
        permission: "people.manage",
        label: "Employees",
        icon: PeopleIcon,
        module: "employees",
        keywords: ["staff", "directory", "team", "org chart", "people"],
      },
      {
        // The second pair of eyes on a bank account or a legal name. Under
        // People rather than Settings: it is a queue about employees, and the
        // person working it is the one who works the rest of this group.
        href: "/employees/change-requests",
        permission: "people.manage",
        label: "Change requests",
        icon: ManageAccountsIcon,
        module: "employees",
        keywords: ["approvals", "bank details", "profile changes", "requests", "amendments"],
      },
      {
        href: "/team",
        // `people.admin` is role-only and never grantable, so this row appears
        // for an owner or an HR admin and for nobody else — including an
        // officer holding every other capability.
        permission: "people.admin",
        label: "Roles & permissions",
        icon: AdminPanelSettingsIcon,
        module: "employees",
        keywords: ["roles", "permissions", "access", "admin", "grant", "owner", "officer"],
      },
      {
        // The legal entities people are employed by — one per project, in this
        // industry. Under People rather than Settings because it is the field
        // on an employee's record, not a system preference: somebody opens
        // this to add the SPV they are about to hire a whole site team into.
        href: "/companies",
        permission: "settings.manage",
        label: "Companies",
        icon: ApartmentIcon,
        module: "employees",
        keywords: [
          "company", "companies", "entity", "subsidiary", "spv", "group",
          "project company", "holding", "legal entity",
        ],
      },
      {
        href: "/recruitment",
        permission: "recruitment.manage",
        label: "Recruitment",
        icon: PersonSearchIcon,
        module: "recruitment",
        keywords: ["hiring", "jobs", "candidates", "interviews", "ats"],
      },
      {
        href: "/checklists",
        permission: "workplace.manage",
        label: "Onboarding",
        icon: ChecklistIcon,
        module: "employees",
        keywords: ["checklists", "offboarding", "joiners", "leavers", "tasks"],
      },
      {
        href: "/training",
        permission: "workplace.manage",
        label: "Training",
        icon: SchoolIcon,
        module: "training",
        keywords: ["courses", "learning", "lms", "certificates"],
      },
      {
        href: "/goals",
        permission: "workplace.manage",
        label: "Goals & OKRs",
        icon: FlagIcon,
        module: "performance",
        keywords: ["objectives", "key results", "performance", "reviews"],
      },
      {
        href: "/reviews",
        permission: "workplace.manage",
        label: "Reviews",
        icon: ReviewsIcon,
        module: "performance",
        keywords: ["appraisal", "performance", "cycle", "self assessment"],
      },
      {
        href: "/surveys",
        permission: "workplace.manage",
        label: "Surveys",
        icon: PollIcon,
        module: "performance",
        keywords: ["enps", "pulse", "engagement", "feedback"],
      },
    ],
  },
  {
    id: "time",
    label: "Time & attendance",
    items: [
      {
        href: "/attendance",
        label: "Attendance",
        icon: EventAvailableIcon,
        module: "attendance",
        keywords: ["punch", "clock in", "clock out", "shifts", "devices"],
      },
      {
        href: "/leave",
        label: "Leave",
        icon: BeachAccessIcon,
        module: "leave",
        keywords: ["holiday", "absence", "time off", "balance", "approvals"],
      },
      {
        href: "/wfh",
        label: "Remote work",
        icon: HomeWorkIcon,
        module: "attendance",
        keywords: ["wfh", "work from home", "hybrid"],
      },
      {
        href: "/timesheets",
        label: "Timesheets",
        icon: ScheduleIcon,
        module: "attendance",
        keywords: ["hours", "billable", "projects", "time entry"],
      },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    items: [
      {
        href: "/payroll",
        permission: "payroll.view",
        label: "Payroll",
        icon: PaymentsIcon,
        module: "payroll",
        keywords: ["salary", "payslip", "tax", "runs", "components", "loans"],
      },
      {
        href: "/expenses",
        label: "Expenses",
        icon: ReceiptLongIcon,
        module: "payroll",
        keywords: ["claims", "reimbursement", "receipts"],
      },
      {
        href: "/reports",
        permission: "reports.view",
        label: "Reports",
        icon: AssessmentIcon,
        module: "dashboard",
        keywords: ["export", "analytics", "xlsx"],
      },
    ],
  },
  {
    id: "workplace",
    label: "Workplace",
    items: [
      {
        href: "/assets",
        permission: "workplace.manage",
        label: "Assets",
        icon: DevicesIcon,
        module: "assets",
        keywords: ["equipment", "laptop", "devices", "inventory"],
      },
      {
        href: "/helpdesk",
        // "Internal" earns its place: there are three support rows in this
        // menu and the labels are the only thing telling them apart.
        label: "Internal helpdesk",
        icon: ConfirmationNumberIcon,
        module: "helpdesk",
        keywords: ["tickets", "support", "it", "requests"],
      },
      {
        href: "/documents",
        label: "Documents",
        icon: FolderIcon,
        module: "documents",
        keywords: ["policies", "files", "signatures", "contracts"],
      },
    ],
  },
  {
    id: "communication",
    label: "Communication",
    items: [
      {
        href: "/announcements",
        label: "Announcements",
        icon: CampaignIcon,
        module: "collaboration",
        keywords: ["notice", "broadcast", "company news"],
      },
    ],
  },
  // **Deliberately not a sidebar group.** Setup is a task with an end: a
  // permanent menu row for something you finish in week one is clutter for
  // every week after. It lives in Settings, is surfaced on the dashboard while
  // it is incomplete, and stays searchable here so ⌘K still finds it.
  {
    id: "business",
    label: "Business",
    items: [
      {
        // The queue, not the pipeline. A support desk is worked every day and
        // a sales pipeline is reviewed weekly, so putting the first behind a
        // menu labelled after the second costs a click on every ticket.
        href: "/crm/tickets",
        permission: "crm.manage",
        label: "Client desk",
        icon: SupportAgentIcon,
        module: "crm",
        keywords: ["support", "tickets", "client desk", "queue", "sla", "complaints"],
      },
      {
        href: "/crm",
        permission: "crm.manage",
        label: "CRM",
        icon: HandshakeIcon,
        module: "crm",
        keywords: ["clients", "deals", "invoices", "sales", "pipeline"],
      },
      {
        // Deliberately unpermissioned. Everybody has tasks; an employee who
        // cannot open the board cannot see what they were asked to do, and the
        // asking then happens somewhere the system never sees. What they may
        // *change* is decided server-side, in `projects/permissions.py`.
        href: "/projects",
        label: "Projects",
        icon: AccountTreeIcon,
        module: "projects",
        keywords: ["tasks", "board", "kanban", "sprints", "backlog", "milestones"],
      },
    ],
  },
];

/** Flat list, for the palette and breadcrumb lookups. */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/**
 * The navigation this user actually has, derived from their capabilities.
 *
 * A row with no `permission` is for everybody. A row with one appears only if
 * the server said they hold it — so a menu item never leads to a wall, which is
 * the single change that stops the product looking broken to an employee.
 *
 * An empty group disappears rather than rendering a heading over nothing.
 */
export function visibleGroups(permissions: readonly string[]): NavGroup[] {
  const held = new Set(permissions);
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.permission || held.has(i.permission)),
  })).filter((g) => g.items.length > 0);
}

/**
 * Routes that are gated but have no sidebar entry.
 *
 * `canOpen` reads the permission off the nav item, which ties "can this page be
 * opened" to "is this page in the rail" — so a gated page that is not in the
 * rail needs an entry here. Without one `activeItem` finds nothing, `canOpen`
 * returns true, and the route guard turns nobody away: the API still refuses,
 * but as a wall of 403s rather than as an answer.
 *
 * Listed here rather than by giving Mail a hidden nav item, because a nav item
 * nobody navigates by is a lie the next reader has to work out.
 */
const ROUTE_PERMISSIONS: Record<string, string> = {
  "/mail": "mail.access",
};

/** Whether this user may open a given path at all — used by the route guard. */
export function canOpen(pathname: string, permissions: readonly string[]): boolean {
  const explicit = Object.entries(ROUTE_PERMISSIONS).find(
    ([route]) => pathname === route || pathname.startsWith(`${route}/`)
  );
  if (explicit) return permissions.includes(explicit[1]);

  const item = activeItem(pathname);
  if (!item?.permission) return true;
  return permissions.includes(item.permission);
}

/**
 * Which nav item owns this path. Longest match wins, so `/payroll/loans`
 * resolves to Payroll rather than to the dashboard's `/`.
 */
export function activeItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`)).sort(
    (a, b) => b.href.length - a.href.length
  )[0];
}

/**
 * Human labels for path segments the nav model doesn't own — the second and
 * third crumb on a nested route. Anything not listed is title-cased, and a
 * bare numeric id becomes "Detail" rather than showing a database key to
 * someone who has no use for it.
 */
const SEGMENT_LABELS: Record<string, string> = {
  runs: "Run",
  components: "Salary components",
  "tax-slabs": "Tax slabs",
  "statutory-rates": "Statutory rates",
  contributions: "Fund contributions",
  org: "Departments & job titles",
  loans: "Loans",
  lifecycle: "Lifecycle",
  "org-chart": "Org chart",
  clients: "Clients",
  deals: "Deals",
  projects: "Projects",
  invoices: "Invoices",
  holidays: "Holidays",
  company: "Company",
  billing: "Billing",
  devices: "Devices",
  email: "Email",
  notifications: "Notifications",
  certificate: "Certificate",
  settings: "Settings",
  profile: "Profile",
  announcements: "Announcements",
  meetings: "Meetings",
  reviews: "Reviews",
  mail: "Mail",
};

export type Crumb = { label: string; href?: string };

const HOME = "/dashboard";

export function breadcrumbsFor(pathname: string, recordLabel?: string): Crumb[] {
  if (pathname === "/" || pathname === HOME) return [];

  // On a module's own page the trail would be "Dashboard › Payroll" while the
  // heading right below already says Payroll, and the sidebar already shows
  // where you are. Breadcrumbs earn their row only once you are nested.
  if (activeItem(pathname)?.href === pathname) return [];

  const segments = pathname.split("/").filter(Boolean);
  const owner = activeItem(pathname);
  const crumbs: Crumb[] = [{ label: "Dashboard", href: HOME }];

  if (owner && owner.href !== HOME) {
    crumbs.push({ label: owner.label, href: owner.href });
  }

  const ownerDepth = owner && owner.href !== HOME ? owner.href.split("/").filter(Boolean).length : 0;

  segments.slice(ownerDepth).forEach((segment, index, rest) => {
    const isLast = index === rest.length - 1;
    const isRecordId = /^\d+$/.test(segment);
    const label =
      SEGMENT_LABELS[segment] ??
      (isRecordId
        ? // A database key means nothing to the reader, so it used to render as
          // "Detail" — honest but useless: every record page in the product
          // ended on the same word. A page that knows what it is showing can
          // say so, and only the page can know.
          (isLast && recordLabel ? recordLabel : "Detail")
        : segment.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase()));
    crumbs.push({
      label,
      href: isLast ? undefined : `/${segments.slice(0, ownerDepth + index + 1).join("/")}`,
    });
  });

  // A single crumb is just the page title repeated — not worth the row.
  return crumbs.length > 1 ? crumbs : [];
}

/**
 * Which nav group a route belongs to — "People", "Finance".
 *
 * Powers the orientation band in `PageHeader`, derived rather than typed out
 * on each page. A per-page string would drift the moment a route moved
 * groups, and thirty of them would drift silently.
 */
export function moduleFor(pathname: string): string | undefined {
  const item = activeItem(pathname);
  if (!item) return undefined;
  return NAV_GROUPS.find((g) => g.items.some((i) => i.href === item.href))?.label;
}
