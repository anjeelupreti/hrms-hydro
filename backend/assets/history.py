"""Recording what happens to an asset.

One function, called from every place that changes an asset, so the register
cannot end up with a status that moved and no entry saying why. Kept out of the
viewset because the offboarding flow and the assignment action both change the
same fields and would otherwise each remember — or forget — separately.
"""

from django.utils import timezone

from assets.models import AssetEvent


def record(asset, kind, *, actor=None, custodian=None, from_value="", to_value="", note="", on=None):
    """Add one entry to an asset's history. Never raises on a bad `kind` —
    the choices are a vocabulary, and a mistyped one is still a fact worth
    keeping over losing the entry entirely."""
    return AssetEvent.objects.create(
        asset=asset,
        kind=kind,
        custodian=custodian,
        from_value=from_value or "",
        to_value=to_value or "",
        note=note or "",
        occurred_on=on or timezone.localdate(),
        actor=actor if getattr(actor, "is_authenticated", False) else None,
    )
