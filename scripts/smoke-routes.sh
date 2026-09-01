#!/usr/bin/env bash
#
# Render every in-shell route against a running dev server and fail on any
# non-200 or any React/MUI runtime error in the output.
#
# Why this exists: a `var(--hrms-status-accent-solid)` reached MUI's `alpha()`,
# which parses colours in JS and throws on `var(…)`. It typechecked, it linted,
# it built, and it crashed the dashboard the moment anyone opened it. `tsc` and
# `next build` do not render pages; this does.
#
# Usage:
#   Backend on :8000, frontend on :3000, then
#     ./scripts/smoke-routes.sh [host] [username] [password]
#
set -uo pipefail

# **The port has moved twice; read this before changing it again.**
#
# It was 3000, then 3001, and is 3000 again on 19 Aug by request. The reason it
# ever left is worth keeping: another project on this machine (`sambehen`) also
# serves on 3000, and when both were installed the script logged into *that*
# app and reported a 307 for every route — a green-looking run that had smoke-
# tested nothing. Whichever process binds the port first wins, silently.
#
# So if this ever reports uniform 307s or a login failure, check what is
# actually listening on the port before believing the routes are broken:
#   netstat -ano | grep :3000
#
# (The username was also wrong here once — the database is built with
# `seed_demo`, and only the accounts it creates exist. Both errors
# had already been fixed in the docs and missed here, which is how a wrong
# default outlives the document that used to carry it.)
HOST="${1:-localhost:3000}"
USER_NAME="${2:-hr}"
PASSWORD="${3:-password123}"
# Honour the port given in $1. This used to be pinned to 3000, so passing a
# host on any other port silently smoke-tested whatever was on 3000 instead —
# or nothing at all.
BASE="http://127.0.0.1:${HOST##*:}"
JAR="$(mktemp)"
PAGE="$(mktemp)"
trap 'rm -f "$JAR" "$PAGE"' EXIT

ROUTES=(
  /dashboard /portal /employees /employees/lifecycle /employees/org-chart /team
  # The one profile page, reached as somebody else and as oneself. `/profile`
  # forwards here, so both rows exercise the same component.
  /employees/1 /companies
  /attendance /attendance/calendar /attendance/1 /leave /wfh /timesheets
  /payroll /payroll/loans /payroll/components /payroll/tax-slabs
  /expenses /assets /helpdesk /documents /training /checklists
  /goals /surveys /reviews /meetings /announcements /mail /calendar
  # `/crm` itself is a redirect stub with nothing to render — its target,
  # /crm/clients, is checked directly below.
  /recruitment /crm/clients /crm/deals /crm/invoices
  # Projects left CRM; /crm/projects now 308s here and is not worth a row.
  /projects
  /crm/tickets
  /reports /notifications /profile
  /settings /settings/holidays /settings/attendance /settings/company
  /settings/devices /settings/email /settings/notifications
)

# Error markers Next.js / React / MUI leave in rendered output.
ERROR_RE="Unsupported .* color|Application error|call of a React Hook|Objects are not valid as a React child|Maximum update depth"

login_code=$(curl -s -c "$JAR" -o /dev/null -w "%{http_code}" -m 20 \
  -X POST "$BASE/api/auth/login" -H "Host: $HOST" -H "Content-Type: application/json" \
  -d "{\"username\":\"$USER_NAME\",\"password\":\"$PASSWORD\"}")

if [ "$login_code" != "200" ]; then
  echo "FATAL: login failed (http $login_code). Is the backend up and seeded?"
  exit 1
fi

fail=0
for route in "${ROUTES[@]}"; do
  code=$(curl -s -b "$JAR" -o "$PAGE" -w "%{http_code}" -m 60 -H "Host: $HOST" "$BASE$route")
  errors=$(grep -ciE "$ERROR_RE" "$PAGE"; true)
  errors=${errors:-0}

  if [ "$code" != "200" ] || [ "$errors" -ne 0 ]; then
    echo "  FAIL $route  http=$code  errors=$errors"
    grep -oiE "$ERROR_RE.{0,90}" "$PAGE" | head -2 | sed 's/^/        /'
    fail=$((fail + 1))
  fi
done

echo "${#ROUTES[@]} routes checked · $fail with problems"
exit $((fail > 0 ? 1 : 0))
