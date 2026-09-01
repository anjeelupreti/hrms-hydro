# HRMS Frontend Developer Guide (Next.js 16 & TypeScript)

Welcome to the **HRMS Frontend** developer documentation. This guide serves as the comprehensive manual for the Next.js 16 single-page / server-rendered web application, explaining the Backend-for-Frontend (BFF) auth architecture, component architecture, state management patterns, theme/styling preferences, package choices, and directory layouts.

---

## 1. Core Architecture & Mental Model

The frontend is scaffolded with **Next.js 16** (App Router), **React 19**, and **TypeScript 5**. 

### Server Components vs Client Components Boundary
* **Server Components (Default in `app/`)**: Render exclusively on the Node.js server. Used for high-level layouts, SEO metadata, server-side data preparation, and static page frames. Their code is never sent to the browser.
* **Client Components (`"use client"`)**: Opt-in components that execute in the browser. Required whenever using interactive hooks (`useState`, `useEffect`, `useQuery`), event handlers (`onClick`, `onChange`), browser APIs, or MUI interactive components.

---

## 2. Backend-for-Frontend (BFF) & Security Architecture

### Why standard `localStorage` JWT Storage is NOT Used
In enterprise HR and payroll applications, storing access tokens in `localStorage` creates severe XSS vulnerabilities. If an attacker injects JavaScript, they can extract the token and compromise every record in the system.

### The BFF Solution (HttpOnly Cookie Proxy Pattern)

```
[ Browser Client Component ]
        │ (fetch /api/proxy/employees/ - No JWT in browser JS!)
        ▼
[ Next.js BFF Proxy ] ──> Reads HttpOnly Cookie 'access_token' server-side
        │              ──> Injects 'Authorization: Bearer <token>'
        ▼
[ Django Backend API ] (http://127.0.0.1:8000/api/v1/employees/)
```

### Key BFF Components:
1. **`proxy.ts` (Next.js 16 Interceptor)**:
   - Replaces older `middleware.ts`.
   - Intercepts requests to protected pages.
   - Checks for the presence of the 7-day `refresh_token` cookie.
   - Sends anybody without one to `/login`. There is no public surface: the only
     world-readable paths are the careers board and a candidate's offer link,
     both listed in `PUBLIC_PATHS`.
2. **`app/api/auth/login/route.ts`**:
   - Posts credentials to Django.
   - Receives JWT pair and sets them as `HttpOnly`, `SameSite=Lax`, `Secure` cookies.
3. **`app/api/proxy/[...path]/route.ts`**:
   - Generic catch-all API proxy for all Django endpoints.
   - Automatically attaches the `Authorization: Bearer` header.
   - Handles **Silent Token Refresh**: If Django returns a `401 Unauthorized`, the proxy automatically calls Django's refresh endpoint using the refresh cookie, updates the access cookie, and transparently retries the original request.
   - **Binary Streaming (`arrayBuffer`)**: Serves payslip PDFs, uploaded images, and Excel reports without UTF-8 string corruption.

---

## 3. Technology Stack & Package Rationale

| Category | Package & Version | Why Used / Purpose | Config / Location |
|---|---|---|---|
| **Framework** | `Next.js 16.2`, `React 19.2` | App Router routing, Turbopack dev bundler, SSR/SSG rendering capabilities | `package.json`, `next.config.ts` |
| **Language** | `TypeScript 5` | Strict static typing across all API payloads, custom hooks, and component props | `tsconfig.json`, `types/*.ts` |
| **UI Components** | `@mui/material 9.2`, `@mui/icons-material 9.2` | Comprehensive, accessible Material Design component library | `components/*`, `lib/theme/` |
| **SSR Theme Cache** | `@mui/material-nextjs 9.1`, `@emotion/cache 11.14` | Prevents Flash of Unstyled Content (FOUC) during Next.js SSR rendering | `lib/theme/ThemeRegistry.tsx` |
| **Server State / API Data** | `@tanstack/react-query 5.101` | Manages server data fetching, client-side caching, auto-refetching, and optimistic updates | `lib/query/QueryProvider.tsx`, `hooks/` |
| **Client UI State** | `zustand 5.0` | Minimal, lightweight client-only UI state management (sidebar collapse, theme mode, filters) | `lib/store/ui.ts` |
| **Data Grids & Tables** | `@mui/x-data-grid 9.8` | High-performance sorting, filtering, and pagination for large employee & payroll datasets | `components/employees/`, `components/payroll/` |
| **Analytics & Charts** | `@mui/x-charts 9.9` | Responsive bar charts, pie charts, and trend graphs for the HR dashboards | `components/dashboard/`, `components/charts/` |
| **Drag & Drop** | `@hello-pangea/dnd 18.0` | Accessible Kanban drag-and-drop board for CRM deals and recruitment candidate pipelines | `components/crm/`, `components/recruitment/` |
| **Calendar Views** | `react-big-calendar 1.20` | Full monthly/weekly/daily schedule view for leave, shift rosters, and company events | `components/calendar/` |
| **Date Utilities** | `date-fns 4.4` | Lightweight date manipulation, formatting, and time calculations | Throughout components and hooks |
| **Animations** | `motion 12.42` (Framer Motion) | Micro-interactions, smooth page transitions, modal dialog animations | `components/common/` |

---

## 4. State Management & Data Flow Architecture

```
  ONE APP, ONE HOST — there is no marketing site and no owner console
  ─────────────────────────────────────────────────────────────────────────
   STATE — server data and UI state never share a home
            ┌─────────────────────────┬─────────────────────────┐
            ▼                                                   ▼
  ┌──────────────────────────────┐              ┌──────────────────────────┐
  │  TanStack Query — server     │              │  Zustand — UI only       │
  │  hooks/use*.ts               │              │  useUIStore()            │
  │  useEmployees · usePayroll   │              │  sidebar mode, theme,    │
  │  useCompanies · useLeave     │              │  amount privacy          │
  │  cache · refetch · invalidate│              │  never mirrors an API    │
  └──────────────┬───────────────┘              └──────────────────────────┘
                 │  fetch("/api/proxy/…")
                 ▼
  ─────────────────────────────────────────────────────────────────────────
   THE BOUNDARY — the browser never holds a Django token
  ┌──────────────────────────────────────────────────────────────────────┐
  │  BFF route handlers (app/api/…) + proxy.ts                            │
  │  · reads the httpOnly cookie, attaches the bearer server-side         │
  │  · refreshes it when Django answers 401                               │
  │  · streams binary responses through untouched                         │
  └──────────────────────────────┬───────────────────────────────────────┘
                                 ▼
                              Django
```

### Data Flow Rules:
1. **Server Data**: ALWAYS managed via **TanStack Query** in `hooks/use*.ts`. Never mirror API response objects into Zustand or local component state.
2. **UI State**: Pure user interface toggles (sidebar state, active tab index, modal open/close) live in **Zustand** or `useState`.

---

## 5. Application Routing & Feature Map

The routing structure in `frontend/app/` maps directly to functional modules:

| App Route Path | Primary Components Path | Hooks & Types | Module Scope |
|---|---|---|---|
| `/` | — | — | Forwards to `/dashboard`, or to `/login`. There is no landing page: this is one company's internal system, not a product with a funnel in front of it. |
| `/dashboard` | `components/dashboard/` | `useDashboard.ts`, `types/dashboard.ts` | The company dashboard — quick stats, upcoming leave, birthdays. Requires `dashboard.view`; employees land on `/portal` instead. |
| `/portal` | `components/portal/` | `useEmployeeProfile.ts` | Where an employee lands. Their own record, balances, payslips and clock. |
| `/login`, `/forgot-password` | `components/auth/` | `useAccount.ts`, `useTwoFactor.ts` | Sign-in, two-factor, password recovery. There is no sign-up: the first account is made with `manage.py bootstrap_owner`, and everybody else is invited from inside. |
| `/employees` | `components/employees/` | `useEmployees.ts`, `types/employees.ts` | The directory; department and designation management. |
| `/employees/[id]` | `components/employees/`, `components/profile/` | `useEmployeeProfile.ts` | **The one profile page.** Every way of opening a person lands here — see `lib/employeeProfile.ts`. What it shows depends on who is looking: a colleague gets the directory entry, the person themselves and anyone with `people.manage` get everything. `/profile` forwards here. |
| `/companies` | `components/companies/` | `useCompanies.ts`, `types/companies.ts` | The group's operating entities — the legal companies people are employed by. |
| `/attendance` | `components/attendance/` | `useAttendance.ts`, `types/attendance.ts` | Punch clock-in/out, attendance logs, shift assignments, biometric log review. |
| `/leave` | `components/leave/` | `useLeave.ts`, `types/leave.ts` | Leave applications, balance counters, multi-level manager approvals. |
| `/payroll` | `components/payroll/` | `usePayroll.ts`, `types/payroll.ts` | Salary structures, tax slab settings, monthly payroll execution, payslip generation. |
| `/crm` | `components/crm/` | `useCrm.ts`, `types/crm.ts` | CRM deals Kanban board, contacts, clients, and invoice generation. |
| `/recruitment` | `components/recruitment/` | `useRecruitment.ts`, `types/recruitment.ts` | Job vacancy postings, applicant tracking (ATS) drag-and-drop pipeline. |
| `/training` | `components/training/` | `useTraining.ts`, `types/training.ts` | Training programs, employee course enrollments, certificate downloads. |
| `/chat` | `components/chat/` | `useChat.ts`, `useChatSocket.ts`, `types/chat.ts` | Real-time chat application with WebSocket integration and attachments. |
| `/expenses` | `components/expenses/` | `useExpenses.ts`, `types/expenses.ts` | Employee expense reimbursement claims and receipt attachment uploads. |
| `/wfh` | `components/wfh/` | `useWfh.ts`, `types/wfh.ts` | Work-From-Home application requests and manager approvals. |
| `/reports` | `components/reports/` | `useReports.ts` | On-demand generic report generator for Excel (`.xlsx`) and JSON exports. |
| `/team` | `components/team/` | `useTeam.ts`, `types/team.ts` | Roles and permissions. The owner appoints HR admins; an admin grants an officer exactly what they need. Requires `people.admin`, which is role-only and never grantable. |
| `/settings` | `components/settings/` | `useOrganization.ts`, `types/organization.ts` | The company profile, the calendar and fiscal year, office hours, email server settings (SMTP/IMAP), review cycles. |

---

## 6. Styling, Theming & UI Preferences

* **Material-UI (MUI v6/v9)** is the primary component library.
* **Theme Configuration (`lib/theme/`)**:
  - Custom brand colors, dark mode support, modern typography, and glassmorphism UI card designs.
  - SSR emotion cache integrated via `ThemeRegistry.tsx` to eliminate hydration flashes.
* **Layout Design**:
  - Dynamic responsiveness using MUI flexbox and Grid components.
  - Floating navigation header and collapsible sidebar controlled via Zustand store (`useUIStore`).

---

## 7. Developer Conventions & Standards

1. **Custom Hooks Pattern**:
   - All domain API calls must be wrapped in custom hooks under `hooks/use<Feature>.ts`.
   - Example: `useEmployees()` returns `{ employees, isLoading, createEmployee }`.
2. **Strict TypeScript Interfaces**:
   - All data contracts live under `types/<feature>.ts`. Never use `any`.
3. **API Proxy Calls**:
   - Always call `/api/proxy/<endpoint>` using `fetch` or custom fetch client. Never hardcode backend ports (`http://localhost:8000`) inside client components.
4. **Error Handling**:
   - Display actionable user notifications on API failures using toast alerts or MUI Alert banners.

---

## 8. Local Setup & Commands

### Prerequisites
* Node.js 20+
* Running Backend (or Docker Compose stack)

### Commands Quick Reference:
```bash
# 1. Install Dependencies
npm install

# 2. Start Development Server (Turbopack Enabled)
npm run dev

# 3. Perform TypeScript Type Check
npx tsc --noEmit

# 4. Run ESLint Validation
npm run lint

# 5. Build for Production
npm run build
```

