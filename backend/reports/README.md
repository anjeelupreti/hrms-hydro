# `reports` app

Company-scoped. Phase 13. A single generic reporting endpoint — one view,
many report `type`s, all returning the same shape so the frontend renders any
report with one component and exports any of them the same way.

No models: reports are computed on demand from the existing company data.

## Endpoint (`/api/v1/reports/`)

`GET reports/?type=<type>&start=<date>&end=<date>` returns:

```json
{
  "type": "...",
  "start": "...", "end": "...",
  "summary": [{"label": "...", "value": 0}],
  "columns": [...],
  "rows": [[...], ...],
  "chart": {"kind": "columns|bars", "title": "...", "unit": "...", "points": [{"label": "...", "value": 0}]}
}
```

Add `&export=xlsx` to get a styled workbook instead of JSON (shared
`XlsxExportMixin` / `xlsx_response`, same helper as
[`expenses`](../expenses/README.md) and payroll).

### `chart`

A builder may return a fourth value, a chart spec — `summary` cards over rows is
a spreadsheet with a header, and you cannot see a trend, a skew or an outlier in
one.

`kind` is `columns` (an ordered sequence — months, payroll periods, pipeline
stages) or `bars` (a ranking — departments by headcount, categories by spend).
Two kinds only, because those are the two the frontend draws well; a third here
would be a chart nothing can render.

**The server chooses the kind, not the browser.** Only the builder knows whether
its rows are a sequence or a ranking, and inferring it client-side from the
column headers is wrong the first time a report has two numeric columns.

`chart` is `null` when there is nothing worth drawing — an empty result, or a
register that is simply a list. That is deliberately different from an empty
chart, which reads as a broken one.

## Report types (`REPORT_TYPES`)

| `type` | Content | Chart |
|---|---|---|
| `team` | Headcount by department, right now | bars |
| `headcount` | Joiners, leavers and net change over the range | columns |
| `recruitment` | Candidates who applied in the range, and where they are now | columns |
| `attendance` | Present / late / absent / half-day per person | bars |
| `leave` | Leave requests over the range | bars |
| `wfh` | Work-from-home / remote requests over the range | bars |
| `payroll` | Gross, deductions and net per period | columns |
| `expenses` | Claims by person and category, and what is still owed | bars |
| `training` | Sessions in the range, enrolments and completions | bars |
| `assets` | The asset register and who holds what, right now | bars |

An unknown `type` returns `400`. Each type is a `_report_<type>(start, end)`
method returning `(summary, columns, rows)` or `(summary, columns, rows, chart)`
— add a report by adding one method and one `REPORT_TYPES` entry; the response
shape, date parsing, XLSX export and the frontend's rendering come for free.

### Ranges, and the two reports that ignore them

`team` and `assets` describe the workspace **as it stands now**. A register
filtered to "assets we owned in March" answers a question nobody asks, and
would make the register look empty whenever somebody narrowed the dates for a
different report. The dates are accepted and ignored; the frontend says so on
the report rather than leaving the reader to wonder.

`training` is the opposite case: its sessions are usually *scheduled*, so a
backward-looking default range is legitimately empty. The frontend offers a
forward range there instead of implying no training exists.

## Tests

`tests/test_reports.py`. The parametrised sweep over `REPORT_TYPES` is
load-bearing: this app reads every other app's tables, so it is the first thing
a rename elsewhere breaks and the last thing anybody runs by hand. Adding a type
to the list adds it to the sweep.
