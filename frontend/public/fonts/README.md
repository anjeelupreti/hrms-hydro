# Nepali fonts for the memorandum editor

Unicode Devanagari needs nothing here — **Noto Sans Devanagari** is bundled with
the application (`next/font` self-hosts it at build time, see `app/layout.tsx`)
and is offered in the editor as "Devanagari".

**Preeti, Kalimati and Sagarmatha are a different problem.** They are legacy
Nepali fonts: not Unicode, but ASCII fonts whose glyphs *look* Devanagari, so
`s;kgL` renders as कम्पनी only when the Preeti face is applied. They are what
most Nepali offices still type in, and they are licensed products — they are not
redistributable, so they are not bundled here and cannot be.

The editor handles this in two steps, in this order:

1. **`local()`** — if the font is installed on the reader's machine, which it is
   on most Nepali office computers, it is used and nothing else is needed.
2. **`url()`** — otherwise the browser looks for a file in this directory.

So if your organisation holds a licence for these fonts, drop the files in with
exactly these names and every user gets them, whether or not their own machine
has them installed:

    public/fonts/preeti.ttf
    public/fonts/kalimati.ttf
    public/fonts/sagarmatha.ttf

Nothing needs rebuilding beyond the usual deploy. A missing file is not an
error: the browser silently falls back, and the editor's font menu says
"not installed on this device" next to any face it cannot find — so the author
is told rather than left wondering why their typing looks like gibberish.

The `@font-face` rules themselves are in `lib/theme/ThemeRegistry.tsx`, declared
with `font-display: swap` so a missing file never blocks the page.
