# Production image for the Django backend (one image, three Render services:
# web / celery-worker / celery-beat — they differ only by start command,
# set per-service in deployment/render.yaml). Built from the repo root with
# `-f deployment/backend/Dockerfile backend`.
FROM python:3.12-slim

# TZ matches `settings.TIME_ZONE`. Django exports its own zone to the process
# on startup, so this is not what makes the *application* agree with itself —
# it is so the container's own tooling (`date`, a shell script, anything that
# runs before Django loads) reports the same day the product does.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=Asia/Kathmandu \
    DJANGO_SETTINGS_MODULE=config.settings.production

WORKDIR /app

# System deps: libpq for psycopg, plus the WeasyPrint runtime stack
# (Pango/Cairo/GDK-PixBuf/fonts) — payslip/invoice PDF rendering needs these
# at runtime, not just build time.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential libpq-dev \
        libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf-2.0-0 libffi-dev \
        libcairo2 shared-mime-info fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements/ requirements/
RUN pip install --no-cache-dir -r requirements/production.txt

COPY backend/ .

# Collect static assets at build time (WhiteNoise/S3 serve them at runtime).
RUN python manage.py collectstatic --noinput || true

EXPOSE 8000

# Default (web) command — ASGI via daphne so Channels websockets (chat) work
# in production, not just HTTP. render.yaml overrides this for the worker/beat
# services. $PORT is provided by Render.
CMD ["sh", "-c", "daphne -b 0.0.0.0 -p ${PORT:-8000} config.asgi:application"]
