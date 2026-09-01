"""Settings for the test suite.

Optimised for speed and determinism, and deliberately *not* derived from
dev.py — a test run must not depend on whatever a developer has toggled
locally. The one thing not faked out is Postgres: the product runs on
Postgres-specific behaviour, so the tests exercise a real Postgres, not
SQLite.
"""

import tempfile

from .base import *  # noqa: F401,F403

DEBUG = False
ALLOWED_HOSTS = ["*"]

# Tests connect to a dedicated database so a stray run can never touch a
# developer's working data. CI overrides these via environment variables.
DATABASES["default"]["NAME"] = env("TEST_DB_NAME", default="hrms_test")  # noqa: F405
DATABASES["default"]["HOST"] = env("TEST_DB_HOST", default=env("DB_HOST", default="localhost"))  # noqa: F405
DATABASES["default"]["PORT"] = env("TEST_DB_PORT", default=env("DB_PORT", default="5432"))  # noqa: F405
DATABASES["default"]["USER"] = env("TEST_DB_USER", default=env("DB_USER", default="hrms"))  # noqa: F405
DATABASES["default"]["PASSWORD"] = env("TEST_DB_PASSWORD", default=env("DB_PASSWORD", default="hrms"))  # noqa: F405

# The single biggest win in a Django test suite — PBKDF2 dominates otherwise.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

# Run Celery work inline. Tests assert on outcomes, not on queue mechanics.
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True

# No Redis dependency in unit tests.
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}

EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"

# Uploads land in a temp dir that the OS reclaims, never in the repo.
MEDIA_ROOT = tempfile.mkdtemp(prefix="hrms-test-media-")
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}

# Throttling off by default: rate limits are asserted explicitly in the tests
# that care, and left out of the way of every other test.
REST_FRAMEWORK = {  # noqa: F405
    **REST_FRAMEWORK,  # noqa: F405
    "DEFAULT_THROTTLE_CLASSES": (),
    "DEFAULT_THROTTLE_RATES": {
        "login": "1000/min",
        "anon": "1000/min",
        "user": "10000/min",
        "device_ingest": "1000/min",
    },
}

# Keep migrations ON — the suite should exercise the schema the product
# actually deploys, not one synthesised from the models.

SENTRY_DSN = ""
