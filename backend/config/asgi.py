import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")

# get_asgi_application() must run (populating the app registry) before any
# module that imports models — chat.routing -> chat.consumers -> models.
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402

from chat.routing import websocket_urlpatterns  # noqa: E402

# No AuthMiddlewareStack here: WebSocket auth + company resolution happen
# inside ChatConsumer via the signed ticket (see chat/consumers.py). The
# consumer is the only websocket route, and it fully self-authenticates,
# so wrapping it in Django's session-based auth stack would add nothing.
application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": URLRouter(websocket_urlpatterns),
    }
)
