"""Who can read an uploaded file.

Written because for the whole life of this product the answer was **anybody**.
`django.conf.urls.static.static` served `MEDIA_ROOT` with no session and no
permission check, and fifteen file fields across nine modules went through it —
citizenship scans, candidate résumés, payslip PDFs, expense receipts, chat
attachments.

Nobody noticed because until the media route was repaired no file could be
fetched at all: the URLs named a hostname that resolved only inside Docker. The
bug hid behind a different bug, which is the argument for these tests existing
rather than a paragraph in a design note.
"""

from pathlib import Path

import pytest
from django.conf import settings

pytestmark = [pytest.mark.django_db]


def _write(path: str, body: bytes = b"\x89PNG-not-really") -> None:
    """Put a file on disk where an upload would live."""
    # MEDIA_ROOT is a str under some settings modules and a Path under others.
    full = Path(settings.MEDIA_ROOT) / path
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_bytes(body)


def test_an_anonymous_request_gets_nothing(api_client):
    _write("employees/photos/1/face.png")

    response = api_client.get("/media/employees/photos/1/face.png")

    # 401/403 rather than 404: the point is that it stopped at the door, and a
    # 404 here would also pass if the gate were missing and the file absent.
    assert response.status_code in (401, 403)


def test_a_signed_in_colleague_can_read_a_file(employee_client):
    _write("employees/photos/1/face.png")

    response = employee_client.get("/media/employees/photos/1/face.png")

    assert response.status_code == 200
    assert b"".join(response.streaming_content) == b"\x89PNG-not-really"


@pytest.mark.parametrize(
    "path",
    [
        "../../../etc/passwd",
        "employees/../../etc/passwd",
        "/etc/passwd",
    ],
)
def test_paths_cannot_climb_out_of_the_media_root(employee_client, path):
    response = employee_client.get(f"/media/{path}")
    assert response.status_code in (400, 404)


def test_a_missing_file_is_a_plain_404(employee_client):
    response = employee_client.get("/media/employees/photos/1/nope.png")
    assert response.status_code == 404
