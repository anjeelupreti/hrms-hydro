"""Short-lived WebSocket connection tickets.

The browser never holds the real JWT access token (it lives in an
httpOnly cookie, readable only by the Next.js BFF), and browsers can't
set Authorization headers on a WebSocket handshake. So the BFF — which
*can* read the cookie — asks Django to mint a short-lived, single-purpose
ticket carrying just the user id, and hands that to the browser to put on
the `ws://.../ws/chat/?ticket=...` URL.

The ticket is a signed (not encrypted) token: it proves Django issued it,
and it expires in 60s — long enough to open a socket, too short to be
worth stealing. It grants nothing but a chat connection, a far smaller
blast radius than exposing the 15-minute access token to JS would be.
"""

from django.core import signing

TICKET_SALT = "chat.ws-ticket"
TICKET_MAX_AGE = 60  # seconds — just enough to open the connection


def mint_ticket(user_id: int) -> str:
    return signing.dumps({"user_id": user_id}, salt=TICKET_SALT)


def read_ticket(ticket: str) -> dict:
    """Returns the ticket payload, or raises signing.BadSignature /
    signing.SignatureExpired if it's forged or older than TICKET_MAX_AGE."""
    return signing.loads(ticket, salt=TICKET_SALT, max_age=TICKET_MAX_AGE)
