"""TOTP (authenticator-app) 2FA helpers, so the crypto and encoding live in
exactly one place.

Design notes:
- Secrets are base32 (pyotp standard). Stored per-account.
- Backup codes are shown once at enable time and stored only as Django
  password hashes (never plaintext) — same hasher as passwords.
- QR is rendered server-side to a data: URI so the frontend needs no QR
  library and no image round-trip.
"""

import base64
import io
import secrets

import pyotp
import qrcode
from django.contrib.auth.hashers import check_password, make_password


def new_secret() -> str:
    return pyotp.random_base32()


def otpauth_uri(secret: str, account_label: str, issuer: str = "HRMS") -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=account_label, issuer_name=issuer)


def qr_data_uri(otpauth: str) -> str:
    """Render the otpauth:// URI to a base64 PNG data URI for an <img src>."""
    img = qrcode.make(otpauth)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def verify_code(secret: str, code: str) -> bool:
    if not secret or not code:
        return False
    # valid_window=1 tolerates a ±30s clock skew between server and device.
    return pyotp.TOTP(secret).verify(str(code).strip().replace(" ", ""), valid_window=1)


def generate_backup_codes(n: int = 10) -> list[str]:
    """Human-friendly one-time codes, e.g. 'a1b2-c3d4'."""
    codes = []
    for _ in range(n):
        raw = secrets.token_hex(4)  # 8 hex chars
        codes.append(f"{raw[:4]}-{raw[4:]}")
    return codes


def hash_codes(codes: list[str]) -> list[str]:
    return [make_password(c) for c in codes]


def consume_backup_code(code: str, hashed: list[str]) -> tuple[bool, list[str]]:
    """If `code` matches one of the stored hashes, return (True, remaining
    hashes with that one removed). Otherwise (False, unchanged)."""
    normalized = str(code).strip().lower().replace(" ", "")
    for i, h in enumerate(hashed or []):
        if check_password(normalized, h):
            return True, hashed[:i] + hashed[i + 1 :]
    return False, hashed
