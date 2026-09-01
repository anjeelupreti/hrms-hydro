"""Production settings — HTTPS/security hardening on top of base.py.

Import via DJANGO_SETTINGS_MODULE=config.settings.production. Everything
here assumes TLS is terminated in front of the app (Render/Vercel/again a
reverse proxy), hence SECURE_PROXY_SSL_HEADER — Django trusts the
X-Forwarded-Proto header the host sets, so it knows the original
request was HTTPS even though it arrives over plain HTTP internally.
"""

from .base import *  # noqa: F401,F403
from .base import env

DEBUG = False

# TLS terminated upstream (Render/reverse proxy) — trust the forwarded proto.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=True)

# Cookies only over HTTPS in production.
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

# HSTS — force HTTPS for a year, include subdomains, allow preload. Start
# with a short max-age when first enabling on a new domain, then raise.
SECURE_HSTS_SECONDS = env.int("SECURE_HSTS_SECONDS", default=31536000)
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True

# Misc hardening headers.
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
X_FRAME_OPTIONS = "DENY"

# CORS/CSRF must be explicit in production — no empty-default free-for-all.
# CORS_ALLOWED_ORIGINS and CSRF_TRUSTED_ORIGINS come from env (see base.py).
