"""Serving uploaded files, with the door shut.

Replaces `django.conf.urls.static.static`, which serves whatever is asked for
and asks nothing in return — no session, no permission, no company. Fifteen file
fields across nine modules go through here, and they are not harmless things:
citizenship scans, candidate résumés, payslip PDFs, expense receipts, payment
proofs, chat attachments.

**The check.** *Are you signed in?* DRF's defaults answer that —
`IsAuthenticated`, the same as every other endpoint gets, rather than a second
home-grown notion of "logged in".

**What this deliberately does not do.** It does not re-derive per-object
permissions from a file path — whether *this* employee's citizenship scan is
readable by *this* colleague. Reversing a path back to a model and its rules
would be a second, guessing implementation of authorisation that could drift
from the real one. Documents that need that already have it: `DocumentViewSet`
has a gated `download` action that runs the real visibility rules and writes an
access log. This is the floor beneath everything — signed in — not a
replacement for those rules.

In production media moves to an S3-compatible bucket and is served by signed
URLs instead; this path is what stands in for that everywhere else.
"""

import mimetypes
from pathlib import Path

from django.conf import settings
from django.core.exceptions import SuspiciousFileOperation
from django.http import FileResponse, Http404
from django.utils._os import safe_join
from rest_framework.views import APIView


class MediaView(APIView):
    """Serve one uploaded file to somebody entitled to it."""

    def get(self, request, path, **kwargs):
        try:
            # Refuses anything that climbs out of MEDIA_ROOT — `../../etc`, an
            # absolute path, a drive letter.
            full = Path(safe_join(settings.MEDIA_ROOT, path))
        except (SuspiciousFileOperation, ValueError):
            raise Http404("No such file.") from None

        if not full.is_file():
            raise Http404("No such file.")

        content_type, _ = mimetypes.guess_type(full.name)
        # Inline: these are rendered in `<img>` tags and previews. The
        # downloads that should arrive as attachments have their own actions.
        return FileResponse(full.open("rb"), content_type=content_type or "application/octet-stream")
