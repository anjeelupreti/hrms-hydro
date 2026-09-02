"""Cleaning the rich text a memorandum carries.

**Why this exists at all.** The content field is written in a browser editor and
stored as HTML, then rendered back into other people's pages — the chain, the
print view, an approver's screen. Storing what the browser sent and rendering it
unescaped is stored cross-site scripting: a memorandum is read by exactly the
senior people whose sessions are worth stealing, which makes it the highest-value
place in the product to put a `<script>`.

**An allow-list, not a block-list.** Listing what is forbidden is a game you
lose to the next HTML specification; listing what is permitted is a decision
that stays correct. Everything not named here is stripped, and its text kept —
so a paste from Word loses its `<o:p>` wrappers and keeps its words.

**No dependency.** `bleach` would be the obvious answer and is unmaintained;
`nh3` is the successor and is a compiled dependency this project does not
otherwise need. What a memorandum needs is a short, fixed list of formatting
tags, and Python's own `HTMLParser` handles that in fifty lines with no supply
chain attached.
"""

from __future__ import annotations

from html import escape
from html.parser import HTMLParser

#: What a memorandum may contain. Deliberately short: this is a formal note,
#: not a web page. No images (attachments are the mechanism for that), no
#: tables yet, no iframes or embeds ever.
ALLOWED_TAGS = {
    "p", "br", "div", "span",
    "strong", "b", "em", "i", "u", "s", "sub", "sup",
    "ul", "ol", "li",
    "h1", "h2", "h3", "h4",
    "blockquote", "pre", "code",
    "a",
}

#: Attributes are allowed per tag rather than globally, because `href` on an
#: anchor is a link and `href` on anything else is somebody being clever.
ALLOWED_ATTRIBUTES = {
    "a": {"href", "title", "target", "rel"},
    # The editor writes alignment and emphasis as inline styles. `style` is
    # filtered property by property below rather than passed through — an
    # unfiltered `style` carries `expression()` and `url(javascript:)`.
    "span": {"style"},
    "p": {"style"},
    "div": {"style"},
    "h1": {"style"}, "h2": {"style"}, "h3": {"style"}, "h4": {"style"},
    "li": {"style"},
}

#: CSS properties a formatting toolbar legitimately produces. Anything else —
#: `position`, `behavior`, `background-image` — is dropped.
ALLOWED_STYLES = {
    "text-align", "font-weight", "font-style", "text-decoration",
    "font-size", "font-family", "color", "background-color",
    "margin-left", "padding-left",
}

#: Tags whose *contents* go with them. Stripping `<script>` and keeping its
#: text would paste executable source into the document as prose.
DROP_CONTENT = {"script", "style", "iframe", "object", "embed", "template"}

VOID = {"br", "img", "hr"}

_SAFE_SCHEMES = ("http://", "https://", "mailto:", "tel:", "/", "#")


def _clean_href(value: str) -> str | None:
    """A link, or nothing.

    Anchored on a scheme allow-list because `javascript:` has a dozen spellings
    once tabs, newlines and HTML entities are in play, and matching on the bad
    ones is how each of those gets discovered separately.
    """
    candidate = (value or "").strip().replace("\x00", "")
    lowered = candidate.lower()
    # Whitespace inside the scheme is how `java\tscript:` gets past a naive check.
    collapsed = "".join(lowered.split())
    if collapsed.startswith(_SAFE_SCHEMES):
        return candidate
    if ":" not in collapsed.split("/")[0]:
        # A relative path with no scheme at all.
        return candidate
    return None


def _clean_style(value: str) -> str:
    kept = []
    for declaration in (value or "").split(";"):
        if ":" not in declaration:
            continue
        prop, _, val = declaration.partition(":")
        prop = prop.strip().lower()
        val = val.strip()
        if prop not in ALLOWED_STYLES:
            continue
        lowered = "".join(val.lower().split())
        if "url(" in lowered or "expression(" in lowered or "javascript:" in lowered:
            continue
        kept.append(f"{prop}: {val}")
    return "; ".join(kept)


class _Sanitizer(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.open_tags: list[str] = []
        self.suppress_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in DROP_CONTENT:
            self.suppress_depth += 1
            return
        if self.suppress_depth or tag not in ALLOWED_TAGS:
            return
        permitted = ALLOWED_ATTRIBUTES.get(tag, set())
        rendered = []
        for name, value in attrs:
            name = (name or "").lower()
            if name not in permitted:
                continue
            if name == "href":
                value = _clean_href(value or "")
                if value is None:
                    continue
            elif name == "style":
                value = _clean_style(value or "")
                if not value:
                    continue
            elif name == "target":
                # A link that opens a tab must not hand it a reference back —
                # `rel` is forced below rather than trusted from the input.
                value = "_blank"
            rendered.append(f' {name}="{escape(value, quote=True)}"')
        if tag == "a" and any(a.startswith(' target=') for a in rendered):
            rendered = [a for a in rendered if not a.startswith(' rel=')]
            rendered.append(' rel="noopener noreferrer"')
        if tag in VOID:
            self.out.append(f"<{tag}{''.join(rendered)} />")
            return
        self.out.append(f"<{tag}{''.join(rendered)}>")
        self.open_tags.append(tag)

    def handle_endtag(self, tag):
        if tag in DROP_CONTENT:
            self.suppress_depth = max(0, self.suppress_depth - 1)
            return
        if self.suppress_depth or tag not in ALLOWED_TAGS or tag in VOID:
            return
        if tag in self.open_tags:
            # Close everything opened inside it too, so a missing `</li>` in the
            # input cannot produce output that nests the rest of the document
            # inside a list item.
            while self.open_tags:
                open_tag = self.open_tags.pop()
                self.out.append(f"</{open_tag}>")
                if open_tag == tag:
                    break

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_data(self, data):
        if self.suppress_depth:
            return
        self.out.append(escape(data, quote=False))

    def handle_comment(self, data):
        # Dropped entirely. Conditional comments are executable in older
        # engines, and a comment carries nothing a reader needs.
        return

    def result(self) -> str:
        while self.open_tags:
            self.out.append(f"</{self.open_tags.pop()}>")
        return "".join(self.out)


def clean_html(value: str) -> str:
    """Strip a memorandum's content down to the formatting it is allowed."""
    if not value:
        return ""
    parser = _Sanitizer()
    parser.feed(value)
    parser.close()
    return parser.result()


def to_text(value: str) -> str:
    """The content as plain text — for search, exports and the notification body."""
    class _Text(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.parts: list[str] = []
            self.skip = 0

        def handle_starttag(self, tag, attrs):
            if tag in DROP_CONTENT:
                self.skip += 1
            elif tag in ("p", "br", "li", "h1", "h2", "h3", "h4", "div"):
                self.parts.append("\n")

        def handle_endtag(self, tag):
            if tag in DROP_CONTENT:
                self.skip = max(0, self.skip - 1)

        def handle_data(self, data):
            if not self.skip:
                self.parts.append(data)

    parser = _Text()
    parser.feed(value or "")
    parser.close()
    return " ".join("".join(parser.parts).split())
