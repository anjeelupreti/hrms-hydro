from .base import *  # noqa: F401,F403

DEBUG = True
# `backend` is the compose service name, and it is how the frontend container's
# BFF reaches this one — server-to-server, inside the Docker network. Without it
# Django answers `DisallowedHost` with a **400 HTML page**, which the BFF then
# tries to `JSON.parse`, so the browser sees an opaque 500 on every login and
# nothing anywhere names the real cause.
#
# Harmless outside Docker: no browser resolves a bare `backend`.
ALLOWED_HOSTS = ["localhost", "127.0.0.1", ".localhost", "backend"]

INSTALLED_APPS += ["django_extensions"]  # noqa: F405
