# `recruitment` app

Company-scoped hiring: job postings + a candidate pipeline (adapted from
the reference template's recruitment screens; not a numbered roadmap
phase).

## Models

- **`JobPosting`** — a role (title, department, location, employment type,
  status draft/open/closed, openings, salary range, description).
- **`Candidate`** — an applicant on a job's pipeline. `stage`
  (applied → screening → interview → offer → hired, or rejected) is the
  kanban column; moving a card is a PATCH to `stage`. Also carries a 0–5
  `rating`, `source`, optional `resume` file, and `interview_at`.
- **`CandidateNote`** — free-text notes / interview key points, authored
  and timestamped; the candidate card shows the count.

## Access — two levels

- **Job postings**: `IsHRAdminOrReadOnly` — any authenticated user can
  browse (an internal job board); only HR writes.
- **Candidates + notes**: `IsHRAdmin` (HR only, both directions) — the
  pipeline, ratings and notes are confidential. A non-HR user gets 403 on
  the candidate endpoints (verified).

## Metrics

`GET jobs/summary/` returns internally-computed figures: `open_positions`,
`total_candidates`, `hired`, and `by_stage` counts — feeding the
recruitment dashboard stat cards. Each job also reports its
`candidate_count`.

## Endpoints (`/api/v1/recruitment/`)

| Endpoint | Purpose |
|---|---|
| `GET/POST/PATCH/DELETE jobs/?status=&department=` | Job postings (write: HR). |
| `GET jobs/summary/` | Recruitment metrics. |
| `GET/POST/PATCH/DELETE candidates/?job=&stage=` | Candidates (HR only). Move a card = PATCH `stage`; rate = PATCH `rating`; schedule = PATCH `interview_at`. |
| `GET/POST candidates/{id}/notes/` | List / add interview notes. |
| `GET candidates/{id}/resume/` | Download résumé (HR only). |

Pipeline UI reuses `@hello-pangea/dnd` (same as the CRM deals board); the
candidate detail dialog exposes the real hiring actions — advance to the
next stage, disqualify, set rating, schedule the interview, and log key
points.
