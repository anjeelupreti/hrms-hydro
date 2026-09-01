# `mail` app

Company-scoped company mailbox (Phase 11c) — a real IMAP-backed inbox plus
compose/reply through SMTP.

Named `mail`, **not** `email` — a top-level app called `email` would
shadow Python's stdlib `email` module (which this app depends on for
parsing).

## Who can do what (access control)

This is the question people ask first, so it's up front. The system has
exactly **two roles**, a `role` field on each `accounts.User`:
`hr_admin` and `employee` (plus Django's `is_superuser`, treated as HR).
There is **one shared company mailbox per company** — not a mailbox per
employee — because there is one set of real email credentials (the
company's, e.g. `support@acme.com`).

| Action | Who | Enforced by |
|---|---|---|
| Configure the company email account (SMTP **and** IMAP host/port/credentials) | HR admins / superuser only | `organization.CompanyEmailSettingsView` — checks `role == hr_admin` on **both** read and write; even seeing the host/username is HR-only |
| Read the inbox / open a message | HR admins / superuser only | this app's `IsHRAdmin` |
| Send / reply | HR admins / superuser only | `IsHRAdmin` |

**Two permission classes exist, and mail deliberately uses the stricter
one** — this is the crux of "how it's defined":

- `accounts.permissions.IsHRAdminOrReadOnly` — anyone authenticated can
  *read*, only HR can *write*. Used for most company config (company
  profile, holidays, leave types…).
- `accounts.permissions.IsHRAdmin` — HR only for **everything, reads
  included**. Used here, because the mailbox exposes the company's real
  shared credentials and potentially sensitive inbound mail. A regular
  employee who opens `/mail` sees an "HR admins only" notice and the API
  returns `403` (there's a test asserting exactly that).

So: **HR sets up the company email account and HR is the only role that
can read or send from it.** Employees never see it.

## How it works, end to end (and how it's possible)

Nothing here is magic — it's the standard mail protocols wired through the
pieces already in the codebase:

1. **Credentials.** HR enters the account's SMTP + IMAP servers and one
   username/password in Settings → Email. The password is encrypted at
   rest with `cryptography.Fernet` (`organization.CompanyEmailSettings`,
   built in Phase 9) and never sent back to the browser — only a
   "password is set" flag is. SMTP and IMAP share the one
   username/password; only the server host/port differ (Gmail:
   `smtp.gmail.com:587` for sending, `imap.gmail.com:993` for reading).
2. **Receiving = IMAP sync.** `services.sync_inbox()` opens an IMAP
   connection with Python's stdlib `imaplib`, lists the newest messages,
   and for any UID we don't already have, downloads and parses it with the
   stdlib `email` module (subject/from/to, plain + HTML bodies,
   attachments, and the `\Seen` flag → our `is_read`). Parsed messages are
   stored as `EmailMessage` rows — that's the "sync to DB" model, so the
   inbox loads instantly from Postgres instead of re-hitting IMAP on every
   open. Re-syncing is safe: the unique `(folder, uid)` constraint means a
   message is never imported twice.
3. **Sending = SMTP.** Compose/reply calls `services.send_email()`, which
   uses Django's ordinary mail layer. That resolves to
   `organization.CompanyAwareEmailBackend` (Phase 9), which sends through
   the company's own SMTP account and From-address. A copy is saved locally
   as a `folder=sent` row so there's a Sent view.
4. **Two ways sync runs.** A **manual** "Sync" button
   (`POST messages/sync/`, bounded to the newest 50 so it can't hang a
   request) and a **background** Celery Beat job
   (`mail.tasks.fanout_sync_inboxes`, every 15 min, per company). Both call
   the same idempotent `sync_inbox()`.
5. **The browser never touches IMAP/SMTP or the credentials.** The Next.js
   app calls the Django API through its server-side BFF proxy; only Django
   ever holds the decrypted password and talks to Gmail.

Verified end to end against a real Gmail account: 50 messages synced over
live IMAP, an attachment parsed, read-marking on open, and a real
send-to-self recorded in Sent.

## Where the credentials live

There is no separate mail-account model. The IMAP/SMTP settings are the
Phase 9 `organization.CompanyEmailSettings` singleton, extended here with
`imap_host` / `imap_port` / `imap_use_ssl`. The username and (encrypted)
password are shared between SMTP and IMAP — it's one account; only the
server coordinates differ (e.g. Gmail: `smtp.gmail.com:587` vs
`imap.gmail.com:993`). Send goes through the existing
`organization.CompanyAwareEmailBackend`, so outbound mail already leaves
under the company's own From address.

## Models

- **`EmailMessage`** — a message synced from IMAP (`folder=inbox`) or a
  local copy of one we sent (`folder=sent`, `is_outgoing=True`). Not an
  `AuditModel`: inbound mail has no author here, and `synced_at` doesn't
  map onto created/updated. `uid` is the IMAP UID, unique within a folder
  (`unique_folder_uid`, conditioned on a non-blank uid) — the dedup key so
  re-syncing never double-imports. Message bodies live in the company DB
  (the sync-to-DB model chosen for this phase); acceptable at the
  shared-disk stage, revisit alongside S3 (see docs/development-plan.md).
- **`EmailAttachment`** — inbound attachment saved to disk under a
  company-namespaced path (same pattern as `documents`/company logo),
  downloadable through a dedicated HR-only endpoint.

## Sync model

Sync is **to the DB**, two ways in:

1. **Manual** — `POST messages/sync/` runs `services.sync_inbox()`
   synchronously (bounded to the newest 50 messages so it can't hang a
   request), returns `{synced: N}`. The UI's Sync button.
2. **Background** — `mail.tasks.fanout_sync_inboxes` (Celery Beat, every
   15 min) fans out `sync_company_inbox` per company; a no-op for companies
   without IMAP configured. Same `sync_inbox()` underneath.

`sync_inbox` is idempotent (skips UIDs already stored), so the manual and
background paths never conflict. It parses with the `email`/`imaplib`
stdlib: text + HTML bodies, attachments, the `\Seen` IMAP flag → local
`is_read`.

## Rendering inbound HTML safely

The reader prefers `body_text`; when only `body_html` exists it renders
inside a **sandboxed iframe with no `allow-scripts`**, so scripts embedded
in untrusted email HTML can't run (XSS guard). Never render email HTML via
`dangerouslySetInnerHTML`.

## Endpoints (`/api/v1/mail/`) — all HR-only

| Endpoint | Purpose |
|---|---|
| `GET messages/?folder=inbox\|sent` | Paged list (lightweight, no bodies). |
| `GET messages/{id}/` | Full message (bodies + attachments); marks it read. |
| `POST messages/sync/` | Pull newest INBOX messages from IMAP now. |
| `POST messages/send/` | Send `{to, subject, body, cc?}` via SMTP; records a SENT copy. |
| `GET messages/unread-count/` | Inbox unread count (nav badge). |
| `GET attachments/{id}/download/` | Download an attachment (registered before the router so it isn't shadowed). |

IMAP credentials are tested before saving via
`POST /api/v1/organization/email-settings/test-imap/` (the IMAP
counterpart of the existing SMTP test), which lives in the `organization`
app next to the settings it validates.
