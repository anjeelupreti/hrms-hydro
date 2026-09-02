"""Mark up a screenshot so a manual can point at things.

A picture of a screen with a numbered step list beside it makes the reader do
the matching: "the Actions button" is a phrase they then have to find. A circled
**2** on the button itself removes that work, and it is the whole reason this
file exists.

Three marks, and deliberately only three:

* ``box``    — a rectangle round a region, for "this whole card"
* ``point``  — a numbered disc, for "click this"
* ``label``  — a short caption on a leader line, for naming a thing

Coordinates are given as **fractions of the image**, not pixels. The
screenshots are captured at ``deviceScaleFactor: 2``, so a 1600-wide viewport
produces a 3200-wide PNG, and a manual written in device pixels breaks the day
somebody recaptures at a different scale. Fractions survive that.

Colours are fixed rather than passed in: a marking that is sometimes red and
sometimes orange stops reading as a marking.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

#: One accent, used for every mark. Chosen to sit on both the light chrome and
#: the indigo panels in this product without disappearing into either.
ACCENT = (222, 45, 64)
ACCENT_SOFT = (222, 45, 64, 38)
WHITE = (255, 255, 255)


def _font(size: int) -> ImageFont.FreeTypeFont:
    """A real font if the box has one, the bundled bitmap otherwise.

    Falls back rather than raising: a manual built without Arial should look
    plainer, not fail to build.
    """
    for candidate in (
        "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ):
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


class Shot:
    """One screenshot, and the marks going onto it."""

    def __init__(self, path: str | Path):
        self.image = Image.open(path).convert("RGB")
        self.width, self.height = self.image.size
        # Marks are drawn onto an overlay so the translucent box fill composites
        # rather than painting solid over the screenshot.
        self.overlay = Image.new("RGBA", self.image.size, (0, 0, 0, 0))
        self.draw = ImageDraw.Draw(self.overlay)
        # Everything scales off the image width, so a mark looks the same size
        # whatever the capture resolution was.
        self.unit = self.width / 100

    def _px(self, x: float, y: float) -> tuple[int, int]:
        return int(x * self.width), int(y * self.height)

    def box(self, x1: float, y1: float, x2: float, y2: float) -> "Shot":
        """A rectangle round a region. Fractions of the image, top-left first."""
        a, b = self._px(x1, y1), self._px(x2, y2)
        self.draw.rectangle([a, b], fill=ACCENT_SOFT)
        self.draw.rectangle([a, b], outline=ACCENT + (255,), width=max(3, int(self.unit * 0.35)))
        return self

    def point(self, n: int, x: float, y: float) -> "Shot":
        """A numbered disc, at the point given.

        Callers place these just *outside* the thing they mark, so the reader
        can still read the button. That means the position can fall off the
        canvas near an edge, so it is clamped to stay wholly visible — a marker
        half off the page is worse than one nudged inwards.
        """
        r = int(self.unit * 1.5)
        cx, cy = self._px(x, y)
        cx = max(r + 2, min(cx, self.width - r - 2))
        cy = max(r + 2, min(cy, self.height - r - 2))
        self.draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ACCENT + (255,))
        font = _font(int(r * 1.35))
        text = str(n)
        left, top, right, bottom = self.draw.textbbox((0, 0), text, font=font)
        self.draw.text(
            (cx - (right - left) / 2 - left, cy - (bottom - top) / 2 - top),
            text,
            font=font,
            fill=WHITE + (255,),
        )
        return self

    def label(self, text: str, x: float, y: float, anchor: str = "left") -> "Shot":
        """A caption in a filled pill, for naming a region.

        `anchor` says which side of the given point the pill sits on, so a label
        near the right edge does not run off the image.
        """
        px, py = self._px(x, y)
        font = _font(int(self.unit * 1.5))
        left, top, right, bottom = self.draw.textbbox((0, 0), text, font=font)
        w, h = right - left, bottom - top
        pad = int(self.unit * 0.6)
        if anchor == "right":
            px -= w + pad * 2
        rect = [px, py, px + w + pad * 2, py + h + pad * 2]
        self.draw.rounded_rectangle(rect, radius=pad, fill=ACCENT + (255,))
        self.draw.text((px + pad - left, py + pad - top), text, font=font, fill=WHITE + (255,))
        return self

    def save(self, path: str | Path, max_width: int = 1800) -> Path:
        """Flatten the marks on and write it out.

        Downscaled on the way: a 3200px PNG is four times the file a Word page
        can show, and a 60 MB document that opens slowly is worse than a sharp
        one nobody waits for.
        """
        out = Image.alpha_composite(self.image.convert("RGBA"), self.overlay).convert("RGB")
        if out.width > max_width:
            ratio = max_width / out.width
            out = out.resize((max_width, int(out.height * ratio)), Image.LANCZOS)
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        out.save(path, "PNG", optimize=True)
        return path
