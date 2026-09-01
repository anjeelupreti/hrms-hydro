# `surveys` app

Company-scoped. Phase 17d. **Pulse surveys & eNPS** — collect employee
feedback and compute an employee Net Promoter Score.

## Models

- **`Survey`** — title, `status` (draft → active → closed), `anonymous` flag.
  Questions nested; responses collected while active.
- **`SurveyQuestion`** — `kind`: `nps` (0–10), `scale5` (1–5), `text`,
  `choice` (with `choices` JSON).
- **`SurveyResponse`** — one submission. `respondent` is null for anonymous
  surveys (no back-link); named surveys record it and block a repeat.
- **`SurveyAnswer`** — per-question value (`numeric_value` for nps/scale/
  choice-index, `text_value` for free text).

## Permissions

- HR creates/edits (drafts), publishes/closes, and views results.
- Employees see only **active** surveys and submit one response each.

## Endpoints (`/api/v1/surveys/`)

| Endpoint | Purpose |
|---|---|
| `GET /` | List (all for HR; active-only for employees) |
| `POST/PATCH/DELETE /<id>/` | Survey CRUD (HR; writable nested `questions`) |
| `POST /<id>/publish/`, `/close/` | Status transitions (HR) |
| `GET /<id>/mine/` | Whether the caller has already answered |
| `POST /<id>/respond/` | Submit `{answers:[{question, numeric_value|text_value}]}` (active only; one per person on named surveys) |
| `GET /<id>/results/` | Aggregates (HR): **eNPS** = %promoters(9–10) − %detractors(0–6); scale averages; choice counts; text answers |
