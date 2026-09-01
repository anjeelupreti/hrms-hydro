"""Calendar data for the browser, from the one table that already exists.

**Why an endpoint rather than a JavaScript library.** A BS date picker needs
month lengths and conversions locally to feel responsive, and the obvious move
is to ship a JS converter. That would put a *second* conversion table in the
product — and this codebase has now been bitten four times by one question
having two answers (two account routes, two fiscal-year keys, two punch paths,
nine hardcoded calendars). A converter that disagrees with the server by one
day is a payroll period boundary in the wrong place, and nothing downstream can
detect it.

So the server serves the grid and the browser renders it. One month is one
small request, cacheable forever — BS month lengths for a past year do not
change — and there is exactly one table.
"""

from datetime import date, timedelta

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.calendars import UnsupportedDateError, get_calendar, company_calendar


class CalendarMonthView(APIView):
    """One month in the company's calendar, with the Gregorian date of each day.

    The Gregorian equivalent is what gets submitted: storage stays Gregorian
    everywhere, and only the presentation changes. That keeps the engine
    country-neutral (§2.3) — a company switching calendars re-renders, it does
    not re-key its data.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, **kwargs):
        calendar = (
            get_calendar(request.query_params["calendar"])
            if request.query_params.get("calendar")
            else company_calendar()
        )

        today = date.today()
        try:
            local_today = calendar.from_gregorian(today)
        except UnsupportedDateError:
            local_today = None

        try:
            year = int(request.query_params.get("year") or (local_today.year if local_today else today.year))
            month = int(request.query_params.get("month") or (local_today.month if local_today else today.month))
        except (TypeError, ValueError):
            return Response({"detail": "year and month must be numbers."}, status=400)

        try:
            length = calendar.month_length(year, month)
            first = calendar.to_gregorian(year, month, 1)
        except (UnsupportedDateError, ValueError) as exc:
            # The table has hard edges and says so rather than extrapolating —
            # a plausible wrong date is worse than an error, because nothing
            # downstream can tell it apart from a right one.
            return Response({"detail": str(exc)}, status=400)

        days = [
            {
                "day": offset + 1,
                "gregorian": (first + timedelta(days=offset)).isoformat(),
                # Weekday of the *Gregorian* day, since that is what actually
                # determines which day of the week somebody is looking at.
                "weekday": (first + timedelta(days=offset)).weekday(),
            }
            for offset in range(length)
        ]

        return Response({
            "calendar": calendar.key,
            "year": year,
            "month": month,
            "month_name": calendar.month_name(month),
            # All twelve, so anything that needs to *offer* a month — the
            # payroll period picker, a filter — can, without the browser
            # keeping its own list of Nepali month names to fall out of step
            # with this one.
            "month_names": list(calendar.month_names),
            "days": days,
            "today": {
                "gregorian": today.isoformat(),
                "year": local_today.year if local_today else today.year,
                "month": local_today.month if local_today else today.month,
                "day": local_today.day if local_today else today.day,
            },
        })


#: A page of anything shows dozens of dates, so the batch form exists. Capped
#: because an uncapped list is a way to ask one request to do unbounded work.
MAX_BATCH = 400


def _convert(calendar, raw):
    """One date, or `None` for a local value the table cannot express."""
    try:
        value = date.fromisoformat(raw)
    except ValueError:
        return None
    try:
        local = calendar.from_gregorian(value)
    except UnsupportedDateError:
        # Outside the table: the caller still gets the Gregorian date back and
        # shows that. A missing date is worse than one in the wrong calendar.
        return None
    return {
        "year": local.year,
        "month": local.month,
        "day": local.day,
        "month_name": calendar.month_name(local.month),
        "label": f"{local.day} {calendar.month_name(local.month)} {local.year}",
    }


class DateConvertView(APIView):
    """Stored Gregorian dates rendered in the company's calendar.

    For *showing* a date — a join date, a payslip period, a row in a table —
    without the browser owning a conversion table.

    Two call shapes, one implementation. `?date=` answers a single date, which
    is what a picker needs; `?dates=a,b,c` answers many, which is what a table
    needs. A list of fifty rows firing fifty requests is the reason the second
    exists — and putting it in a *second* view is how the two would eventually
    come to disagree.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, **kwargs):
        calendar = company_calendar()
        batch = request.query_params.get("dates")

        if batch is not None:
            raws = [part for part in (p.strip() for p in batch.split(",")) if part]
            if len(raws) > MAX_BATCH:
                return Response(
                    {"detail": f"Too many dates — {MAX_BATCH} at a time."}, status=400
                )
            # Keyed by the date as asked, so the caller can look up what it
            # sent without matching on order.
            return Response({
                "calendar": calendar.key,
                "dates": {raw: _convert(calendar, raw) for raw in raws},
            })

        raw = request.query_params.get("date")
        if not raw:
            return Response(
                {"detail": "date is required, as YYYY-MM-DD (or dates, comma-separated)."},
                status=400,
            )
        try:
            date.fromisoformat(raw)
        except ValueError:
            return Response({"detail": "date must be YYYY-MM-DD."}, status=400)

        return Response({
            "calendar": calendar.key,
            "gregorian": raw,
            "local": _convert(calendar, raw),
        })
