# Deployment

## Local development

`docker-compose.yml` provides the shared infrastructure — Postgres, Redis,
and Mailhog (a fake SMTP server with a web UI at http://localhost:8025 for
viewing emails sent in dev, used from Phase 1 onward for password reset
emails etc.).

```
docker compose up -d postgres redis mailhog
```

Run Django and Next.js directly on the host during development (see
`../backend/README.md` and `../frontend/README.md`) — this is faster to
iterate on than rebuilding containers on every code change.

> **Deploying?** Two blueprints, and they are not interchangeable.
> `render.yaml` is the real thing — managed Postgres, Redis, a worker and a
> beat service. `render.free.yaml` is a **free demo**: one web service, Neon
> for Postgres, Vercel for the frontend, no Redis and no scheduler. See
> [`FREE-DEMO.md`](FREE-DEMO.md), which lists what free costs before you find
> out on stage.

**Postgres is on the conventional host port 5432.** If you also run a native Postgres
install commonly already owns 5432 on Windows dev machines; remapping
avoids the collision. Container-to-container traffic (e.g. from the
`backend` service defined below) still uses the standard internal port
5432 — only the host-facing port changed.

### Full containerized mode

`docker-compose.yml` also defines `backend`, `celery-worker`, `celery-beat`,
and `frontend` services, if you want to run everything in containers
instead:

```
docker compose up
```

This builds the backend image from `backend/Dockerfile.dev` and runs the
frontend from a plain `node:22-alpine` image with the source bind-mounted
(no separate Dockerfile needed for frontend dev). Source directories are
bind-mounted for both, so code changes still hot-reload.

## Production (Phase 17a)

- **Backend**: one production image (`backend/Dockerfile`, built from the
  repo root with `dockerContext: .`), deployed to Render as three services
  defined in **`render.yaml`** — `web` (ASGI via **daphne**, so Channels
  websockets/chat work, not just HTTP), `celery-worker`, `celery-beat`.
  They share one env group; secrets (`SECRET_KEY`, `FIELD_ENCRYPTION_KEY`,
  SMTP, payment keys, `SENTRY_DSN`, `AWS_*`) are set in the Render dashboard
  (`sync: false`), never committed. Postgres + Redis are managed add-ons in
  the same blueprint. Runs under `config.settings.production` (HSTS, secure
  cookies, `SECURE_PROXY_SSL_HEADER` for Render's TLS termination).
- **Deploy**: Render → New → Blueprint, pointed at `render.yaml`. Each deploy
  runs `migrate` (`preDeployCommand`). **Bootstrap**: after the first deploy,
  run `manage.py bootstrap_owner --email …` to create the account the system
  is administered from, and add the Render service hostname to `ALLOWED_HOSTS`
  so the health check (`/api/v1/health/`) answers.
- **DB/Redis wiring**: `DATABASE_URL` (managed-host style) is honored when
  set, else the individual `DB_*` vars. Redis backs Celery broker/result and
  the Channels layer.
- **Media storage**: set `AWS_STORAGE_BUCKET_NAME` (+ creds, optional
  `AWS_S3_ENDPOINT_URL` for R2/MinIO/Spaces) to move uploads off local disk
  (which Render loses on redeploy) to S3-compatible object storage.
- **Frontend**: deployed to Vercel, which builds Next.js natively — no
  Dockerfile in the actual deployment. One hostname; there is no subdomain
  routing to arrange.
- **Observability**: set `SENTRY_DSN` on the backend services for error and
  trace capture.
