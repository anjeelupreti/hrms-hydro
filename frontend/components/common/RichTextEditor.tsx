"use client";

import FormatAlignCenterIcon from "@mui/icons-material/FormatAlignCenter";
import FormatClearIcon from "@mui/icons-material/FormatClear";
import FormatColorTextIcon from "@mui/icons-material/FormatColorText";
import FormatIndentDecreaseIcon from "@mui/icons-material/FormatIndentDecrease";
import FormatIndentIncreaseIcon from "@mui/icons-material/FormatIndentIncrease";
import GridOnIcon from "@mui/icons-material/GridOn";
import HorizontalRuleIcon from "@mui/icons-material/HorizontalRule";
import LinkIcon from "@mui/icons-material/Link";
import LinkOffIcon from "@mui/icons-material/LinkOff";
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
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import type { SxProps, Theme } from "@mui/material/styles";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * A paragraph builder — bold, italic, headings, lists, alignment.
 *
 * **Why `contentEditable` and not an editor library.** A memorandum needs a
 * short, fixed set of formatting commands — marks, blocks, lists, alignment,
 * links and a plain table — and nothing else: no images, no collaborative
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
 * Applied with `fontName` under `styleWithCSS`, which writes a
 * `<span style="font-family: …">` the sanitiser keeps — so the face survives
 * being saved and read back, which is the only thing that makes it useful.
 *
 * **These are the machine's fonts, not ours.** Preeti, Kalimati and Sagarmatha
 * are not web fonts and are not shipped with this application — they are
 * installed on Nepali office machines, and on a machine without them the option
 * silently does nothing at all: the text stays Latin gibberish and the author
 * is left thinking the editor is broken. `probe` marks the ones worth checking
 * for, and the menu says plainly when one is missing rather than pretending.
 *
 * The stack faces need no probe: they name a generic family last, so the
 * browser always has something to fall back to.
 */
const FONTS: { label: string; value: string; probe?: string }[] = [
  { label: "Default", value: "" },
  { label: "Preeti", value: "Preeti", probe: "Preeti" },
  { label: "Kalimati", value: "Kalimati", probe: "Kalimati" },
  { label: "Sagarmatha", value: "Sagarmatha", probe: "Sagarmatha" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Mono", value: "ui-monospace, monospace" },
];

/**
 * Is a font actually installed here?
 *
 * Measured rather than asked, because there is no API that answers it: the text
 * is drawn once in a known generic family and once in `<candidate>, <generic>`,
 * and if the candidate is missing the browser falls back and both come out the
 * same width. Three generics, because a font can happen to match one of them.
 *
 * The string mixes wide and narrow glyphs on purpose — a font that differs only
 * in its punctuation would measure identically on letters alone.
 */
function fontIsInstalled(family: string) {
  if (typeof document === "undefined") return true;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return true;
  const sample = "mmmmmmmmmmlli WMil0O1|";
  return ["monospace", "serif", "sans-serif"].some((generic) => {
    context.font = `72px ${generic}`;
    const base = context.measureText(sample).width;
    context.font = `72px "${family}", ${generic}`;
    return context.measureText(sample).width !== base;
  });
}

type Mark = "bold" | "italic" | "underline" | "strikeThrough";

/** Inline, because the stored HTML is rendered by three different things —
 *  this editor, the letter preview, and the browser's print view — and only a
 *  style attribute survives all three. A stylesheet here would style the
 *  editor and leave the printed letter with an unruled table. */
const CELL_STYLE = "border: 1px solid #9aa0a6; padding: 6px 8px; vertical-align: top";
const TABLE_STYLE = "width: 100%; border-collapse: collapse; margin: 0 0 0.8em";

function tableHtml(rows: number, columns: number) {
  const head = `<tr>${`<th style="${CELL_STYLE}; background-color: #f1f3f4">&nbsp;</th>`.repeat(columns)}</tr>`;
  const body = `<tr>${`<td style="${CELL_STYLE}">&nbsp;</td>`.repeat(columns)}</tr>`.repeat(Math.max(rows - 1, 1));
  return `<table style="${TABLE_STYLE}"><thead>${head}</thead><tbody>${body}</tbody></table><p><br></p>`;
}

/** The cell the caret is in, or null. `anchorNode` is a text node more often
 *  than not, so this walks up rather than testing the node itself. */
function cellAtCaret(root: HTMLElement | null): HTMLTableCellElement | null {
  const selection = typeof window === "undefined" ? null : window.getSelection();
  const node = selection?.anchorNode ?? null;
  if (!node || !root?.contains(node)) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return (element?.closest("th, td") as HTMLTableCellElement | null) ?? null;
}



export default function RichTextEditor({
  value,
  onChange,
  disabled = false,
  minHeight = 260,
  placeholder = "Write the memorandum…",
  renderLayout,
  surfaceSx,
}: {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  minHeight?: number;
  placeholder?: string;
  /**
   * Put the toolbar and the writing surface wherever the caller needs them.
   *
   * **Because the memorandum is written on the page itself.** The two used to
   * be welded into one bordered box, which forced the layout that box implies:
   * an editor over here and a preview of the letter over there, so the author
   * typed into a grey form and watched a document appear somewhere else. What
   * they actually want is Word — the controls along the top, and the paper
   * underneath with the words landing on it.
   *
   * A render prop rather than two exported components because the toolbar and
   * the surface share the selection, the mark state and the `execCommand`
   * plumbing; splitting them into siblings would mean lifting all of that into
   * a context for the sake of one layout.
   */
  renderLayout?: (parts: { toolbar: ReactNode; surface: ReactNode }) => ReactNode;
  /** Styles for the writing surface — used to make it inherit the page. */
  surfaceSx?: SxProps<Theme>;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [block, setBlock] = useState("p");
  const [tableMenu, setTableMenu] = useState<HTMLElement | null>(null);
  const [inTable, setInTable] = useState(false);

  // Probed once per mount, not per render: it draws to a canvas, and the answer
  // cannot change while the page is open.
  const missingFonts = useMemo(() => {
    const missing = new Set<string>();
    for (const font of FONTS) {
      if (font.probe && !fontIsInstalled(font.probe)) missing.add(font.label);
    }
    return missing;
  }, []);

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
    setInTable(Boolean(cellAtCaret(ref.current)));
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

  /**
   * Table editing, done against the DOM rather than through `execCommand`.
   *
   * There are no table commands to call: `execCommand` can insert the HTML and
   * nothing more, so a table without these is one somebody has to get the size
   * of right first time and can never correct. Each operation works from the
   * cell the caret is in, which is what makes "add a row" mean *here*.
   */
  function editTable(operation: "rowBefore" | "rowAfter" | "colBefore" | "colAfter" | "dropRow" | "dropCol" | "dropTable") {
    if (disabled) return;
    const cell = cellAtCaret(ref.current);
    const row = cell?.parentElement as HTMLTableRowElement | null;
    const table = cell?.closest("table");
    if (!cell || !row || !table) return;

    const index = Array.from(row.cells).indexOf(cell);
    const allRows = Array.from(table.rows);

    const newCell = (like: HTMLTableCellElement) => {
      const created = document.createElement(like.tagName.toLowerCase() === "th" ? "th" : "td");
      created.setAttribute("style", like.getAttribute("style") ?? CELL_STYLE);
      created.innerHTML = "&nbsp;";
      return created;
    };

    if (operation === "rowBefore" || operation === "rowAfter") {
      const created = row.cloneNode(false) as HTMLTableRowElement;
      for (const source of Array.from(row.cells)) created.appendChild(newCell(source));
      // A new row is always a body row: cloning a header row into <thead>
      // would give the table a second set of column titles.
      const body = table.tBodies[0] ?? table;
      if (row.parentElement === body) {
        body.insertBefore(created, operation === "rowBefore" ? row : row.nextSibling);
      } else {
        body.insertBefore(created, operation === "rowBefore" ? body.firstChild : body.firstChild);
      }
    } else if (operation === "colBefore" || operation === "colAfter") {
      for (const each of allRows) {
        const source = each.cells[Math.min(index, each.cells.length - 1)];
        if (!source) continue;
        each.insertBefore(newCell(source), operation === "colBefore" ? source : source.nextSibling);
      }
    } else if (operation === "dropRow") {
      // Removing the last row leaves an empty <table> that renders as nothing
      // and cannot be clicked back into — take the whole table instead.
      if (allRows.length <= 1) table.remove();
      else row.remove();
    } else if (operation === "dropCol") {
      if ((allRows[0]?.cells.length ?? 0) <= 1) table.remove();
      else for (const each of allRows) each.cells[index]?.remove();
    } else {
      table.remove();
    }

    setTableMenu(null);
    ref.current?.focus();
    syncToolbar();
    report();
  }

  const isEmpty = !value || value === "<br>" || value === "<p></p>";

  const toolbar = (
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
              <ListItemText
                primary={f.label}
                // Still selectable when missing. The face is stored with the
                // text, so a memorandum written here opens correctly on a
                // machine that *does* have Preeti — and the person printing it
                // is usually not the person who typed it. Saying so is the
                // honest half; refusing the choice would be the wrong one.
                secondary={missingFonts.has(f.label) ? "not installed on this device" : undefined}
                slotProps={{
                  primary: { sx: { fontSize: 13 } },
                  secondary: { sx: { fontSize: 11 } },
                }}
              />
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

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

        {/* Indent, for the numbered sub-clauses a formal letter is full of. */}
        {(
          [
            ["outdent", FormatIndentDecreaseIcon, "Decrease indent"],
            ["indent", FormatIndentIncreaseIcon, "Increase indent"],
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

        <Tooltip title="Table">
          <span>
            <ToggleButton
              size="small"
              value="table"
              selected={inTable}
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => setTableMenu(e.currentTarget)}
              sx={{ border: 0, p: 0.5 }}
            >
              <GridOnIcon fontSize="small" />
            </ToggleButton>
          </span>
        </Tooltip>

        <Menu
          anchorEl={tableMenu}
          open={Boolean(tableMenu)}
          onClose={() => setTableMenu(null)}
          slotProps={{ paper: { sx: { minWidth: 210 } } }}
        >
          <MenuItem
            sx={{ fontSize: 13 }}
            onClick={() => {
              setTableMenu(null);
              run("insertHTML", tableHtml(3, 3));
            }}
          >
            Insert 3 x 3 table
          </MenuItem>
          <MenuItem
            sx={{ fontSize: 13 }}
            onClick={() => {
              setTableMenu(null);
              run("insertHTML", tableHtml(5, 2));
            }}
          >
            Insert 5 x 2 table
          </MenuItem>
          <Divider />
          {(
            [
              ["rowBefore", "Row above"],
              ["rowAfter", "Row below"],
              ["colBefore", "Column left"],
              ["colAfter", "Column right"],
            ] as const
          ).map(([operation, label]) => (
            <MenuItem key={operation} sx={{ fontSize: 13 }} disabled={!inTable} onClick={() => editTable(operation)}>
              {label}
            </MenuItem>
          ))}
          <Divider />
          {(
            [
              ["dropRow", "Delete row"],
              ["dropCol", "Delete column"],
              ["dropTable", "Delete table"],
            ] as const
          ).map(([operation, label]) => (
            <MenuItem
              key={operation}
              sx={{ fontSize: 13, color: "error.main" }}
              disabled={!inTable}
              onClick={() => editTable(operation)}
            >
              {label}
            </MenuItem>
          ))}
        </Menu>

        <Tooltip title="Horizontal rule">
          <span>
            <ToggleButton
              size="small"
              value="hr"
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run("insertHorizontalRule")}
              sx={{ border: 0, p: 0.5 }}
            >
              <HorizontalRuleIcon fontSize="small" />
            </ToggleButton>
          </span>
        </Tooltip>

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

        <Tooltip title="Link">
          <span>
            <ToggleButton
              size="small"
              value="link"
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                // A plain prompt rather than a dialog: a link in a memorandum
                // is rare, and a modal inside a modal is worse than a box.
                const href = window.prompt("Link address", "https://");
                if (href) run("createLink", href);
              }}
              sx={{ border: 0, p: 0.5 }}
            >
              <LinkIcon fontSize="small" />
            </ToggleButton>
          </span>
        </Tooltip>

        <Tooltip title="Remove link">
          <span>
            <ToggleButton
              size="small"
              value="unlink"
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run("unlink")}
              sx={{ border: 0, p: 0.5 }}
            >
              <LinkOffIcon fontSize="small" />
            </ToggleButton>
          </span>
        </Tooltip>

        <Tooltip title="Text colour">
          <ToggleButton
            size="small"
            value="colour"
            disabled={disabled}
            component="label"
            onMouseDown={(e) => e.preventDefault()}
            sx={{ border: 0, p: 0.5, position: "relative", cursor: "pointer" }}
          >
            <FormatColorTextIcon fontSize="small" />
            <Box
              component="input"
              type="color"
              // The native picker, kept out of the layout: it is one element,
              // it is keyboard accessible, and every browser already has one.
              sx={{ position: "absolute", width: 0, height: 0, opacity: 0 }}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                run("foreColor", event.target.value)
              }
            />
          </ToggleButton>
        </Tooltip>

        <Tooltip title="Clear formatting">
          <span>
            <ToggleButton
              size="small"
              value="clear"
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run("removeFormat")}
              sx={{ border: 0, p: 0.5 }}
            >
              <FormatClearIcon fontSize="small" />
            </ToggleButton>
          </span>
        </Tooltip>

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
  );

  const surface = (
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
            "& table": {
              width: "100%",
              borderCollapse: "collapse",
              margin: "0 0 0.8em",
              // Deliberately *not* `display: block` with `overflow-x: auto`.
              // That is the usual trick for keeping a wide table from pushing
              // the page sideways, and on a table element it also breaks
              // `width: 100%`: the block box shrinks to its contents, so a
              // table of empty cells drew about a fifth of the page wide.
              // `table-layout: fixed` is the version that works — the columns
              // divide the width they are given instead of demanding their own.
              tableLayout: "fixed",
            },
            "& th, & td": { border: "1px solid #9aa0a6", padding: "6px 8px", verticalAlign: "top" },
            "& th": { backgroundColor: "rgba(0,0,0,0.04)", fontWeight: 600, textAlign: "left" },
            "& caption": { captionSide: "top", textAlign: "left", fontWeight: 600, paddingBottom: 4 },
            "& hr": { border: 0, borderTop: "1px solid", borderColor: "divider", margin: "1em 0" },
            "& blockquote": {
              margin: "0 0 0.75em",
              paddingLeft: "1em",
              borderLeft: "3px solid",
              borderColor: "divider",
              color: "text.secondary",
            },
            // Last, so a caller placing this on the letter can hand it the
            // page's serif and its ink and have them win.
            ...surfaceSx,
          }}
        />
      </Box>
  );

  if (renderLayout) return <>{renderLayout({ toolbar, surface })}</>;

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
      {toolbar}
      {surface}
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
        "& table": {
          width: "100%",
          borderCollapse: "collapse",
          margin: "0 0 0.8em",
          // Deliberately *not* `display: block` with `overflow-x: auto`.
          // That is the usual trick for keeping a wide table from pushing
          // the page sideways, and on a table element it also breaks
          // `width: 100%`: the block box shrinks to its contents, so a
          // table of empty cells drew about a fifth of the page wide.
          // `table-layout: fixed` is the version that works — the columns
          // divide the width they are given instead of demanding their own.
          tableLayout: "fixed",
        },
        "& th, & td": { border: "1px solid #9aa0a6", padding: "6px 8px", verticalAlign: "top" },
        "& th": { backgroundColor: "rgba(0,0,0,0.04)", fontWeight: 600, textAlign: "left" },
        "& caption": { captionSide: "top", textAlign: "left", fontWeight: 600, paddingBottom: 4 },
        "& hr": { border: 0, borderTop: "1px solid", borderColor: "divider", margin: "1em 0" },
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
