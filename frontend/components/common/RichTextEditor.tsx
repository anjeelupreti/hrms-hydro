"use client";

import FormatAlignCenterIcon from "@mui/icons-material/FormatAlignCenter";
import FormatAlignJustifyIcon from "@mui/icons-material/FormatAlignJustify";
import FormatAlignLeftIcon from "@mui/icons-material/FormatAlignLeft";
import FormatAlignRightIcon from "@mui/icons-material/FormatAlignRight";
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import FormatItalicIcon from "@mui/icons-material/FormatItalic";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import FormatUnderlinedIcon from "@mui/icons-material/FormatUnderlined";
import RedoIcon from "@mui/icons-material/Redo";
import StrikethroughSIcon from "@mui/icons-material/StrikethroughS";
import UndoIcon from "@mui/icons-material/Undo";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A paragraph builder — bold, italic, headings, lists, alignment.
 *
 * **Why `contentEditable` and not an editor library.** A memorandum needs eight
 * formatting commands and nothing else: no tables, no images, no collaborative
 * cursors, no plugin system. The libraries that provide those weigh 100–300 kB
 * and bring their own document model, which then has to be serialised to HTML
 * anyway because that is what the API stores and what the print view renders.
 * `document.execCommand` is deprecated and unlovely, and it is also implemented
 * everywhere, produces exactly the HTML the sanitiser already allows, and adds
 * nothing to the bundle.
 *
 * **The server sanitises, not this.** Everything typed here is cleaned by
 * `memoranda/sanitize.py` on the way in — an allow-list of tags and CSS
 * properties. This component's job is to make writing pleasant; it is not a
 * security boundary and must never be treated as one, because a determined
 * author can paste anything and a second author can post to the API directly.
 *
 * **Uncontrolled on purpose.** Writing `innerHTML` back on every keystroke
 * destroys the caret — it jumps to the start of the box after each character.
 * So the value seeds the node once and `onChange` reports outward; the parent
 * holds the text, and the DOM holds the selection.
 */

const FONT_SIZES = [
  { label: "Small", value: "2" },
  { label: "Normal", value: "3" },
  { label: "Large", value: "5" },
  { label: "Huge", value: "6" },
];

const BLOCKS = [
  { label: "Paragraph", value: "p" },
  { label: "Heading 1", value: "h1" },
  { label: "Heading 2", value: "h2" },
  { label: "Heading 3", value: "h3" },
  { label: "Quote", value: "blockquote" },
];

/**
 * The faces a memorandum actually gets typed in.
 *
 * **Preeti is why this list exists.** It is the legacy Nepali font almost every
 * office in the country still types in: it is not Unicode Devanagari but an
 * ASCII font whose glyphs *look* Nepali, so `s;kgL` renders as कम्पनी only when
 * the Preeti face is applied. Text pasted from an older document therefore
 * arrives as Latin gibberish in any other font, and somebody typing on a Preeti
 * keyboard layout sees the same. Offering the face is the whole fix — the
 * characters were always right, they were being drawn with the wrong shapes.
 *
 * Kalimati and Sagarmatha are the other two in common use and cost a line each.
 * Unicode Devanagari is served by the body face and needs no entry.
 *
 * Applied with `fontName`, which writes a `<font face>` the sanitiser keeps as
 * a style — so the face survives being saved and read back, which is the only
 * thing that makes it useful.
 */
const FONTS = [
  { label: "Default", value: "" },
  { label: "Preeti", value: "Preeti" },
  { label: "Kalimati", value: "Kalimati" },
  { label: "Sagarmatha", value: "Sagarmatha" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Mono", value: "ui-monospace, monospace" },
];

type Mark = "bold" | "italic" | "underline" | "strikeThrough";

export default function RichTextEditor({
  value,
  onChange,
  disabled = false,
  minHeight = 260,
  placeholder = "Write the memorandum…",
}: {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  minHeight?: number;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [block, setBlock] = useState("p");

  // Seeded once, and again only when the value changes from *outside* — a
  // different memorandum opened, or a draft loaded. Comparing against what the
  // node already holds is what stops the caret being reset on every keystroke.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (node.innerHTML !== value) node.innerHTML = value || "";
  }, [value]);

  const report = useCallback(() => {
    if (ref.current) onChange(ref.current.innerHTML);
  }, [onChange]);

  /** Which marks are on at the caret, so the toolbar reflects the text. */
  const syncToolbar = useCallback(() => {
    if (disabled) return;
    const active: Mark[] = [];
    for (const mark of ["bold", "italic", "underline", "strikeThrough"] as Mark[]) {
      try {
        if (document.queryCommandState(mark)) active.push(mark);
      } catch {
        // Some browsers throw when the selection is outside the editor.
      }
    }
    setMarks(active);
    try {
      const current = document.queryCommandValue("formatBlock") || "p";
      setBlock(current.toLowerCase().replace(/[<>]/g, "") || "p");
    } catch {
      setBlock("p");
    }
  }, [disabled]);

  function run(command: string, argument?: string) {
    if (disabled) return;
    // The editor has to hold the selection for the command to apply to it —
    // clicking a toolbar button moves focus to the button otherwise, and the
    // command lands on nothing.
    ref.current?.focus();
    // **Spans, not `<font>`.** With `styleWithCSS` off — the default in
    // Chromium — `fontName` and `fontSize` emit `<font face>` and `<font
    // size>`, and `<font>` is not on the sanitiser's tag allow-list. The tag is
    // dropped on save and the face goes with it, so choosing Preeti would work
    // until the moment it was stored. Turning it on makes the same commands
    // write `<span style="font-family: …">`, which the sanitiser keeps because
    // `font-family` is an allowed property.
    try {
      document.execCommand("styleWithCSS", false, "true");
    } catch {
      // Not implemented everywhere; the command below still runs.
    }
    document.execCommand(command, false, argument);
    syncToolbar();
    report();
  }

  const isEmpty = !value || value === "<br>" || value === "<p></p>";

  return (
    <Box
      sx={(theme) => ({
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        overflow: "hidden",
        opacity: disabled ? 0.6 : 1,
        "&:focus-within": { borderColor: theme.palette.primary.main },
      })}
    >
      <Stack
        direction="row"
        spacing={0.25}
        useFlexGap
        sx={(theme) => ({
          flexWrap: "wrap",
          alignItems: "center",
          p: 0.5,
          bgcolor: alpha(theme.palette.text.primary, 0.03),
          borderBottom: "1px solid",
          borderColor: "divider",
        })}
      >
        <Select
          size="small"
          value={BLOCKS.some((b) => b.value === block) ? block : "p"}
          onChange={(e) => run("formatBlock", `<${e.target.value}>`)}
          disabled={disabled}
          sx={{ minWidth: 128, "& .MuiSelect-select": { py: 0.5, fontSize: 13 } }}
        >
          {BLOCKS.map((b) => (
            <MenuItem key={b.value} value={b.value} sx={{ fontSize: 13 }}>
              {b.label}
            </MenuItem>
          ))}
        </Select>

        <Select
          size="small"
          value=""
          displayEmpty
          renderValue={() => "Font"}
          onChange={(e) => run("fontName", String(e.target.value))}
          disabled={disabled}
          sx={{ minWidth: 92, "& .MuiSelect-select": { py: 0.5, fontSize: 13 } }}
        >
          {FONTS.map((f) => (
            <MenuItem
              key={f.label}
              value={f.value}
              sx={{ fontSize: 13, fontFamily: f.value || undefined }}
            >
              {f.label}
            </MenuItem>
          ))}
        </Select>

        <Select
          size="small"
          value=""
          displayEmpty
          renderValue={() => "Size"}
          onChange={(e) => run("fontSize", String(e.target.value))}
          disabled={disabled}
          sx={{ minWidth: 84, "& .MuiSelect-select": { py: 0.5, fontSize: 13 } }}
        >
          {FONT_SIZES.map((f) => (
            <MenuItem key={f.value} value={f.value} sx={{ fontSize: 13 }}>
              {f.label}
            </MenuItem>
          ))}
        </Select>

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

        {(
          [
            ["bold", FormatBoldIcon, "Bold"],
            ["italic", FormatItalicIcon, "Italic"],
            ["underline", FormatUnderlinedIcon, "Underline"],
            ["strikeThrough", StrikethroughSIcon, "Strikethrough"],
          ] as const
        ).map(([command, Icon, label]) => (
          <Tooltip key={command} title={label}>
            <span>
              <ToggleButton
                size="small"
                value={command}
                selected={marks.includes(command as Mark)}
                disabled={disabled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(command)}
                sx={{ border: 0, p: 0.5 }}
              >
                <Icon fontSize="small" />
              </ToggleButton>
            </span>
          </Tooltip>
        ))}

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

        {(
          [
            ["insertUnorderedList", FormatListBulletedIcon, "Bulleted list"],
            ["insertOrderedList", FormatListNumberedIcon, "Numbered list"],
          ] as const
        ).map(([command, Icon, label]) => (
          <Tooltip key={command} title={label}>
            <span>
              <ToggleButton
                size="small"
                value={command}
                disabled={disabled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(command)}
                sx={{ border: 0, p: 0.5 }}
              >
                <Icon fontSize="small" />
              </ToggleButton>
            </span>
          </Tooltip>
        ))}

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

        {(
          [
            ["justifyLeft", FormatAlignLeftIcon, "Align left"],
            ["justifyCenter", FormatAlignCenterIcon, "Centre"],
            ["justifyRight", FormatAlignRightIcon, "Align right"],
            ["justifyFull", FormatAlignJustifyIcon, "Justify"],
          ] as const
        ).map(([command, Icon, label]) => (
          <Tooltip key={command} title={label}>
            <span>
              <ToggleButton
                size="small"
                value={command}
                disabled={disabled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(command)}
                sx={{ border: 0, p: 0.5 }}
              >
                <Icon fontSize="small" />
              </ToggleButton>
            </span>
          </Tooltip>
        ))}

        <Box sx={{ flex: 1 }} />

        {([["undo", UndoIcon, "Undo"], ["redo", RedoIcon, "Redo"]] as const).map(
          ([command, Icon, label]) => (
            <Tooltip key={command} title={label}>
              <span>
                <ToggleButton
                  size="small"
                  value={command}
                  disabled={disabled}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => run(command)}
                  sx={{ border: 0, p: 0.5 }}
                >
                  <Icon fontSize="small" />
                </ToggleButton>
              </span>
            </Tooltip>
          )
        )}
      </Stack>

      <Box sx={{ position: "relative" }}>
        {isEmpty ? (
          <Typography
            aria-hidden
            sx={{
              position: "absolute",
              top: 16,
              left: 16,
              color: "text.disabled",
              pointerEvents: "none",
            }}
          >
            {placeholder}
          </Typography>
        ) : null}
        <Box
          ref={ref}
          component="div"
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={report}
          onBlur={report}
          onKeyUp={syncToolbar}
          onMouseUp={syncToolbar}
          // Plain text on paste. A paste from Word carries several kilobytes of
          // `mso-` styling and `<o:p>` wrappers that the sanitiser strips
          // anyway — taking the text here means what somebody sees pasted is
          // what will be stored, rather than formatting that vanishes on save.
          onPaste={(e) => {
            e.preventDefault();
            const text = e.clipboardData.getData("text/plain");
            document.execCommand("insertText", false, text);
            report();
          }}
          sx={{
            minHeight,
            p: 2,
            outline: "none",
            fontSize: 14.5,
            lineHeight: 1.65,
            "& p": { margin: "0 0 0.75em" },
            "& h1": { fontSize: "1.5rem", margin: "0.6em 0 0.4em" },
            "& h2": { fontSize: "1.25rem", margin: "0.6em 0 0.4em" },
            "& h3": { fontSize: "1.1rem", margin: "0.6em 0 0.4em" },
            "& ul, & ol": { margin: "0 0 0.75em", paddingLeft: "1.6em" },
            "& blockquote": {
              margin: "0 0 0.75em",
              paddingLeft: "1em",
              borderLeft: "3px solid",
              borderColor: "divider",
              color: "text.secondary",
            },
          }}
        />
      </Box>
    </Box>
  );
}

/**
 * Rendering stored memorandum content.
 *
 * `dangerouslySetInnerHTML` with a name that says so, used in exactly two
 * places. It is safe **because the server sanitised it on the way in** — see
 * `memoranda/sanitize.py`, an allow-list of tags and CSS properties applied in
 * `validate_content`. Nothing here re-checks it, deliberately: two sanitisers
 * means two allow-lists, and the second one to fall behind is the one nobody
 * looks at.
 */
export function RichText({ html }: { html: string }) {
  return (
    <Box
      sx={{
        fontSize: 14.5,
        lineHeight: 1.7,
        "& p": { margin: "0 0 0.8em" },
        "& h1": { fontSize: "1.5rem", margin: "0.6em 0 0.4em" },
        "& h2": { fontSize: "1.25rem", margin: "0.6em 0 0.4em" },
        "& h3": { fontSize: "1.1rem", margin: "0.6em 0 0.4em" },
        "& ul, & ol": { margin: "0 0 0.8em", paddingLeft: "1.6em" },
        "& blockquote": {
          margin: "0 0 0.8em",
          paddingLeft: "1em",
          borderLeft: "3px solid",
          borderColor: "divider",
          color: "text.secondary",
        },
      }}
      dangerouslySetInnerHTML={{ __html: html || "" }}
    />
  );
}
