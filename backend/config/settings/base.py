from datetime import timedelta
from pathlib import Path

import environ
from celery.schedules import crontab

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env(
    DEBUG=(bool, False),
)
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("SECRET_KEY")
DEBUG = env("DEBUG")
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=[])

# --- Applications ---------------------------------------------------------
# One company, one database, one schema. daphne must be first so it overrides
# `runserver` with an ASGI server — Django Channels (WebSockets for the chat
# app) needs the ASGI stack, not the default WSGI dev server.
INSTALLED_APPS = [
    "daphne",
    "channels",
    "django.contrib.auth",
    "django.contrib.admin",
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "django.contrib.sessions",
    "django.contrib.messages",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "django_filters",
    "corsheaders",
    "core",
    "accounts",
    "employees",
    "attendance",
    "notifications",
    "leave",
    "documents",
    "payroll",
    "organization",
    "companies",
    "crm",
    "events",
    "memoranda",
    "fieldvisits",
    "projects",
    "dashboard",
    "chat",
    "mail",
    "training",
    "recruitment",
    "wfh",
    "expenses",
    "checklists",
    "timesheets",
    "goals",
    "assets",
    "helpdesk",
    "surveys",
    "personal",
]


MIDDLEWARE = [
    # First, so every log line emitted for this request carries its id.
    "core.observability.RequestContextMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# Channel layer backs the chat WebSockets (group broadcast). Reuses the
# same Redis as Celery but on a separate DB (/2) so chat pub/sub traffic
# never collides with the Celery broker (/0) or result backend.
#
# **`memory` exists for a free tier that has no Redis to offer**, and its limit
# is worth stating rather than discovering: an in-memory layer is per-process,
# so a broadcast reaches only the clients attached to *that* process. On a
# single free instance that is every client, and chat works. Add a second
# instance and two people are in the same room seeing different messages, with
# nothing logged anywhere to say so.
#
# Redis is the default. A deployment opts out; it never happens by accident.
if env("CHANNEL_LAYER", default="redis") == "memory":
    CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
else:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {
                "hosts": [env("CHANNEL_LAYERS_REDIS_URL", default="redis://localhost:6379/2")],
            },
        },
    }

# DATABASE_URL (managed-host style — Neon, Render) takes precedence when set;
# otherwise the individual DB_* vars (local/docker).
if env("DATABASE_URL", default=""):
    DATABASES = {"default": env.db("DATABASE_URL")}
    # Managed Postgres is remote and TLS-only; a local socket is neither.
    DATABASES["default"].setdefault("OPTIONS", {})
    DATABASES["default"]["OPTIONS"].setdefault(
        "sslmode", env("DATABASE_SSLMODE", default="require")
    )
    # Reused connections matter more when the database is a network hop away.
    # `0` (Django's default) opens a new one per request, which on a managed
    # host means a TLS handshake per request.
    DATABASES["default"]["CONN_MAX_AGE"] = env.int("DB_CONN_MAX_AGE", default=60)
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": env("DB_NAME", default="hrms"),
            "USER": env("DB_USER", default="hrms"),
            "PASSWORD": env("DB_PASSWORD", default="hrms"),
            "HOST": env("DB_HOST", default="localhost"),
            "PORT": env("DB_PORT", default="5432"),
        }
    }

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"

# The zone every "today" in this system is answered in — fiscal years, period
# boundaries, invoice dates, the nightly sweeps.
#
# Django exports this to the process on startup (`Settings.__init__` sets
# `os.environ["TZ"]` and calls `time.tzset()`), so `date.today()` and
# `timezone.localdate()` agree everywhere inside the application, whatever the
# container's own clock is set to.
#
# Env-driven so a deployment outside Nepal sets one variable rather than
# editing settings.
TIME_ZONE = env("DJANGO_TIME_ZONE", default="Asia/Kathmandu")
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# Uploaded media (documents, payslips, receipts, photos, chat attachments).
# STORAGES is the single seam for storage backends — app code
# (documents/services.py etc.) never changes. When AWS_STORAGE_BUCKET_NAME
# is set, media moves to an S3-compatible bucket (real S3, Cloudflare R2,
# MinIO, DigitalOcean Spaces — anything with an S3 API via AWS_S3_ENDPOINT_URL);
# otherwise it stays on local disk (fine for dev, lost on Render redeploys —
# docs/development-plan.md Known Risk #3, which this closes for production).
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

AWS_STORAGE_BUCKET_NAME = env("AWS_STORAGE_BUCKET_NAME", default="")
if AWS_STORAGE_BUCKET_NAME:
    AWS_ACCESS_KEY_ID = env("AWS_ACCESS_KEY_ID", default="")
    AWS_SECRET_ACCESS_KEY = env("AWS_SECRET_ACCESS_KEY", default="")
    AWS_S3_REGION_NAME = env("AWS_S3_REGION_NAME", default="")
    # Set for non-AWS S3-compatible providers (R2/MinIO/Spaces); blank = real S3.
    AWS_S3_ENDPOINT_URL = env("AWS_S3_ENDPOINT_URL", default="") or None
    AWS_S3_CUSTOM_DOMAIN = env("AWS_S3_CUSTOM_DOMAIN", default="") or None
    AWS_DEFAULT_ACL = None  # respect the bucket's own ACL/policy
    AWS_QUERYSTRING_AUTH = env.bool("AWS_QUERYSTRING_AUTH", default=True)  # signed URLs
    AWS_S3_FILE_OVERWRITE = False
    _default_storage = {
        "BACKEND": "storages.backends.s3.S3Storage",
        "OPTIONS": {"default_acl": None, "querystring_auth": AWS_QUERYSTRING_AUTH},
    }
else:
    _default_storage = {"BACKEND": "django.core.files.storage.FileSystemStorage"}

STORAGES = {
    "default": _default_storage,
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- DRF ---------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_VERSIONING_CLASS": "rest_framework.versioning.URLPathVersioning",
    "DEFAULT_VERSION": "v1",
    "ALLOWED_VERSIONS": ["v1"],
    "DEFAULT_FILTER_BACKENDS": ("django_filters.rest_framework.DjangoFilterBackend",),
    "DEFAULT_PAGINATION_CLASS": "core.pagination.DefaultPagination",
    "PAGE_SIZE": 25,
    # Anti-abuse throttles. `login` is applied to the token endpoint to
    # blunt credential brute-forcing (see accounts.views); the global
    # anon/user rates are a generous backstop against runaway clients —
    # tuned high enough not to affect normal use (the notification feed
    # polls every 30s, chat is websocket-based), env-overridable per deploy.
    "DEFAULT_THROTTLE_CLASSES": (
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {
        "login": env("LOGIN_THROTTLE_RATE", default="10/min"),
        "anon": env("ANON_THROTTLE_RATE", default="60/min"),
        "user": env("USER_THROTTLE_RATE", default="2000/min"),
        # Job applications from the company's public careers page. Open to the
        # world and it accepts a file, so it is the tightest of the public
        # rates — a genuine applicant sends one or two, and anything sending
        # twenty an hour is not applying for a job.
        "job_application": env("JOB_APPLICATION_THROTTLE_RATE", default="6/hour"),
        # Candidate offer links. Unauthenticated and keyed by a secret, so the
        # rate is what makes guessing pointless rather than merely slow — a
        # legitimate candidate opens their link a handful of times and answers
        # once.
        "offer_response": env("OFFER_RESPONSE_THROTTLE_RATE", default="20/hour"),
        # Biometric terminals pushing punches. Generous — a busy site with
        # several devices polls often — but not unbounded.
        "device_ingest": env("DEVICE_INGEST_THROTTLE_RATE", default="120/min"),
    },
}

CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=[])

SIMPLE_JWT = {
    # 🔒 Off by default in SimpleJWT, and the default was silently wrong for us.
    #
    # Everything here authenticates by token, so `User.last_login` was never
    # written by anything — it stayed NULL for every account. That is not
    # cosmetic: "when did this person last sign in" is the question behind
    # dormant-account review and offboarding checks, and both were quietly
    # answering "never".
    #
    # It costs one UPDATE per *login* — refreshes do not obtain a new pair — so
    # roughly one write per person per day.
    "UPDATE_LAST_LOGIN": True,
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "TOKEN_OBTAIN_SERIALIZER": "accounts.serializers.HRMSTokenObtainPairSerializer",
}

# --- Email ------------------------------------------------------------
# Defaults match Mailhog (deployment/docker-compose.yml) for local dev;
# override in .env for a real SMTP provider (e.g. Gmail — see
# backend/README.md for the app-password caveat).
# CompanyAwareEmailBackend reads organization.CompanyEmailSettings (when one
# is configured and active) and overrides host/port/credentials/from-address
# per send; falls back to the defaults below when unset.
EMAIL_BACKEND = "organization.email_backend.CompanyAwareEmailBackend"
EMAIL_HOST = env("EMAIL_HOST", default="localhost")
EMAIL_PORT = env.int("EMAIL_PORT", default=1025)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=False)

# Encrypts CompanyEmailSettings.encrypted_password at rest (Fernet).
# Generate one per environment with:
#   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# NEVER rotate this in place once a real password is stored — rotating
# without re-encrypting every row first means every existing password
# silently fails to decrypt (get_password() fails closed to "", not an
# exception — see organization/models.py).
FIELD_ENCRYPTION_KEY = env("FIELD_ENCRYPTION_KEY", default="")
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="noreply@hrms.local")

# Base URL of the frontend, used to build password-reset links in emails.
FRONTEND_BASE_URL = env("FRONTEND_BASE_URL", default="http://localhost:3000")

# --- Web Push (VAPID) -----------------------------------------------------
VAPID_PRIVATE_KEY = env("VAPID_PRIVATE_KEY", default="")
VAPID_PUBLIC_KEY = env("VAPID_PUBLIC_KEY", default="")
VAPID_CONTACT_EMAIL = env("VAPID_CONTACT_EMAIL", default="admin@hrms.local")

# --- Celery --------------------------------------------------------------
CELERY_BROKER_URL = env("CELERY_BROKER_URL", default="redis://localhost:6379/0")
CELERY_RESULT_BACKEND = env("CELERY_RESULT_BACKEND", default="redis://localhost:6379/0")
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = TIME_ZONE

# **Run tasks inline instead of queueing them.** For a deployment with no
# worker process — a free tier that does not offer one — this keeps every
# feature working: an invitation still emails, a payroll run still computes.
#
# What it costs, which matters for judging a demo rather than a product:
#
#  * The request waits for the work. A payroll run over a hundred employees
#    happens while somebody's browser spins, and can outlive the host's
#    request timeout.
#  * **`CELERY_BEAT_SCHEDULE` does not run at all.** Nothing is scheduled with
#    no beat process, so the leave accrual, the absence sweep and the
#    reminders never fire. On a demo that is invisible until a
#    date rolls over and nothing happens.
#
# Off by default. A real deployment runs the worker.
CELERY_TASK_ALWAYS_EAGER = env.bool("CELERY_TASK_ALWAYS_EAGER", default=False)
#: With eager tasks an exception surfaces in the request rather than vanishing
#: into a worker log nobody is reading.
CELERY_TASK_EAGER_PROPAGATES = env.bool("CELERY_TASK_EAGER_PROPAGATES", default=True)

CELERY_BEAT_SCHEDULE = {
    "annual-leave-accrual": {
        "task": "leave.tasks.apply_annual_leave_accrual",
        # Runs daily; the task itself is a no-op unless today is the
        # configured reset day.
        "schedule": crontab(hour=0, minute=15),
    },
    # Just after midnight, so a forgotten clock-out is closed against the day
    # it belongs to before anybody reads that day's hours. Runs ahead of the
    # leave accrual because payroll reads attendance and nothing reads this.
    "sweep-open-sessions": {
        "task": "attendance.tasks.sweep_open_sessions",
        "schedule": crontab(hour=0, minute=5),
    },
    "birthday-reminders": {
        "task": "notifications.tasks.send_birthday_reminders",
        "schedule": crontab(hour=7, minute=0),
    },
    "work-anniversary-reminders": {
        "task": "notifications.tasks.send_work_anniversary_reminders",
        "schedule": crontab(hour=7, minute=0),
    },
    "holiday-reminders": {
        "task": "notifications.tasks.send_holiday_reminders",
        "schedule": crontab(hour=6, minute=0),
    },
    "configured-reminders": {
        "task": "notifications.tasks.send_configured_reminders",
        # Every advance warning HR has configured — probation ending, a
        # passport running out, a holiday coming up, a task falling due.
        # One entry rather than one per kind: what fires is decided by
        # `ReminderRule` rows, so adding a new kind is a registry entry rather
        # than a schedule change.
        #
        # Early, and before the same-day greetings at 07:00, so somebody
        # opening their mail finds "your probation ends in a week" above
        # "happy birthday" rather than under it.
        "schedule": crontab(hour=6, minute=30),
    },
    "sweep-suspensions": {
        "task": "employees.tasks.sweep_suspensions",
        # Before the working day. A suspension that ended last night should be
        # lifted by the time the person tries to sign in, not at lunchtime.
        "schedule": crontab(hour=0, minute=20),
    },
    "apply-due-lifecycle-events": {
        "task": "employees.tasks.apply_due_lifecycle_events",
        # Catches APPROVED events whose effective_date has now arrived —
        # events approved with an effective_date already <= today are
        # applied immediately at approval time instead (see
        # employees.services.decide).
        "schedule": crontab(hour=0, minute=30),
    },
    "create-monthly-payroll-draft": {
        "task": "payroll.tasks.create_monthly_draft_run",
        # 1st of the month — creates a DRAFT run for the month that just
        # ended. Computation only starts once HR calls the run's `run`
        # action; this never auto-triggers payroll processing.
        "schedule": crontab(day_of_month=1, hour=1, minute=0),
    },
    "sync-inboxes": {
        "task": "mail.tasks.sync_company_inbox",
        # Background IMAP sync of the company mailbox. HR can also trigger an
        # immediate sync from the UI; this keeps it fresh between.
        "schedule": crontab(minute="*/15"),
    },
}

# --- Security defaults (safe in every env; production.py tightens further) --
# Cookies: JWT auth rides in the Next.js BFF's own httpOnly cookies, but
# Django's own session/CSRF cookies (admin, browsable API) still deserve
# hardening. SameSite=Lax + HttpOnly are safe everywhere; the *Secure* flag
# is turned on in production.py (would break plain-HTTP local dev).
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
# Hosts allowed to send cross-site POSTs with a CSRF cookie (admin/forms).
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])
# The BFF talks to Django server-to-server with a Bearer token; browser CORS
# is only for any direct calls. Allow credentials so cookie-bearing requests
# from the allow-listed origins work.
CORS_ALLOW_CREDENTIALS = True

# --- Sentry (env-gated; a no-op until SENTRY_DSN is set) ------------------
# Same DSN switch works in dev, staging and prod.
SENTRY_DSN = env("SENTRY_DSN", default="")
if SENTRY_DSN:
    import sentry_sdk
    from sentry_sdk.integrations.celery import CeleryIntegration
    from sentry_sdk.integrations.django import DjangoIntegration

    sentry_sdk.init(
        dsn=SENTRY_DSN,
        environment=env("SENTRY_ENVIRONMENT", default="development"),
        integrations=[DjangoIntegration(), CeleryIntegration()],
        traces_sample_rate=env.float("SENTRY_TRACES_SAMPLE_RATE", default=0.0),
        send_default_pii=False,  # never ship PII to the error tracker
    )


# --- Logging -------------------------------------------------------------
# Every line carries the request id (see core.observability), so grepping one
# id gives the whole story of a request across modules.
LOG_LEVEL = env("LOG_LEVEL", default="INFO")

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {
        "request_context": {"()": "core.observability.RequestContextFilter"},
    },
    "formatters": {
        "standard": {
            "format": "%(asctime)s %(levelname)s [%(request_id)s] "
                      "%(name)s: %(message)s",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "filters": ["request_context"],
            "formatter": "standard",
        },
    },
    "root": {"handlers": ["console"], "level": LOG_LEVEL},
    "loggers": {
        # Django's own request logger duplicates what the handler already
        # prints for 4xx/5xx; keep it but don't double-propagate.
        "django.request": {"handlers": ["console"], "level": "ERROR", "propagate": False},
        # Very chatty at DEBUG and drowns everything else during tests.
        "django.db.backends": {"level": "INFO"},
    },
}
