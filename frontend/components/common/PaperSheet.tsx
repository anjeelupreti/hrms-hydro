"use client";

import AddIcon from "@mui/icons-material/Add";
import PrintIcon from "@mui/icons-material/Print";
import RemoveIcon from "@mui/icons-material/Remove";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A sheet of paper on a desk: size, scale, pagination and printing.
 *
 * **Extracted because a minute is the same object as a memorandum.** Both are
 * documents that get printed, filed and referred back to, and both need the
 * same four things — a real paper size, a scale that fits the column, page
 * boundaries where the paper actually ends, and a print that comes out at 1:1.
 * That is roughly three hundred lines, and the second document needing it is
 * the moment to stop it being memorandum-specific rather than the moment to
 * copy it.
 *
 * What it does *not* know is what goes on the page. The caller renders that.
 */

/**
 * The paper, in millimetres, because that is the unit it is sold in.
 *
 * **A4 first, because that is what the office has in the tray.** The rest are
 * here because a document is not always a letter: an annual statement goes on
 * Legal, a wide schedule on A3, a short note on A5. `name` is what goes in the
 * menu — a ream is labelled "Legal", not "215.9 × 355.6".
 *
 * 18mm of margin is the usual for a letterhead: enough for a punch hole on the
 * left and a file stamp at the foot without crowding the text. A3 is given
 * more, because a margin that looks generous on A4 looks like an accident on a
 * sheet twice the size.
 */
export const PAGE_SIZES = {
  a4: { name: "A4", width: 210, height: 297, margin: 18, css: "A4" },
  a5: { name: "A5", width: 148, height: 210, margin: 14, css: "A5" },
  a3: { name: "A3", width: 297, height: 420, margin: 24, css: "A3" },
  letter: { name: "Letter", width: 215.9, height: 279.4, margin: 18, css: "Letter" },
  legal: { name: "Legal", width: 215.9, height: 355.6, margin: 18, css: "Legal" },
} as const;

export type PageSizeKey = keyof typeof PAGE_SIZES;

/** CSS millimetres are defined against 96dpi, so this is exact, not a guess. */
export const PX_PER_MM = 96 / 25.4;

export default function PaperSheet({
  children,
  /** Show the size picker, page count, add/remove page and print. */
  controls = true,
  /** Extra buttons in the control row — Sign, Edit/Preview, whatever the
   *  document needs. Placed before Print. */
  actions,
  /** Anything positioned against the sheet itself: signatures, stamps. */
  overlays,
}: {
  children: ReactNode;
  controls?: boolean;
  actions?: ReactNode;
  overlays?: ReactNode;
}) {
  const [sizeKey, setSizeKey] = useState<PageSizeKey>("a4");
  const PAGE = PAGE_SIZES[sizeKey];
  const contentHeightPx = (PAGE.height - PAGE.margin * 2) * PX_PER_MM;

  const sheetRef = useRef<HTMLDivElement | null>(null);
  const flowRef = useRef<HTMLDivElement | null>(null);
  const [naturalPages, setNaturalPages] = useState(1);
  const [addedPages, setAddedPages] = useState(0);
  const [scale, setScale] = useState(1);

  /**
   * How many sheets the writing actually fills.
   *
   * Measured rather than declared: the page count has to answer to what has
   * been written. Whole pages only — half a sheet of A4 is still a sheet.
   */
  useEffect(() => {
    const node = flowRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const filled = Math.ceil(node.scrollHeight / contentHeightPx);
      setNaturalPages(Math.max(1, Number.isFinite(filled) ? filled : 1));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [contentHeightPx]);

  /**
   * Shrink the sheet to whatever width it has been given.
   *
   * Scaled rather than reflowed — reflowing would mean the line breaks on
   * screen were not the line breaks on paper, which defeats previewing.
   */
  useEffect(() => {
    const node = sheetRef.current?.parentElement?.parentElement;
    if (!node || typeof ResizeObserver === "undefined") return;
    const fit = () => {
      // The content box, not `clientWidth` — that includes the desk's padding,
      // so the sheet would be scaled to the full width and then drawn inside
      // the padding, overhanging the desk on one side.
      const style = window.getComputedStyle(node);
      const available =
        node.clientWidth -
        parseFloat(style.paddingLeft || "0") -
        parseFloat(style.paddingRight || "0");
      const wanted = PAGE.width * PX_PER_MM;
      setScale(available > 0 ? Math.min(1, available / wanted) : 1);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => observer.disconnect();
  }, [PAGE.width]);

  const pages = naturalPages + addedPages;

  /**
   * Print through a frame of its own.
   *
   * The alternative is a print stylesheet that hides the rest of the
   * application, and "the rest" here is a dialog inside a scrolling page
   * inside a sidebar layout — every one of which contributes a clip that turns
   * up on paper.
   */
  const handlePrint = useCallback(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(frame);

    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) {
      frame.remove();
      return;
    }

    /**
     * The styles, read out of the CSSOM rather than off the DOM.
     *
     * **`outerHTML` on the `<style>` tags is not enough and looks like it is.**
     * In a production build Emotion inserts rules with `sheet.insertRule`,
     * which leaves the elements present but empty — so the printed document
     * came out with its typography roughly right and every flex row collapsed.
     */
    const head = Array.from(document.styleSheets)
      .map((s) => {
        try {
          return `<style>${Array.from(s.cssRules)
            .map((rule) => rule.cssText)
            .join("\n")}</style>`;
        } catch {
          return s.href ? `<link rel="stylesheet" href="${s.href}">` : "";
        }
      })
      .join("");

    doc.open();
    doc.write(
      `<!doctype html><html><head><meta charset="utf-8">${head}` +
        `<style>@page { size: ${PAGE.css}; margin: 0 } ` +
        `html,body { margin:0; padding:0; background:#fff }` +
        // The scale is a screen concern; on paper the page is already A4.
        `.print-sheet { transform:none !important; box-shadow:none !important; border:0 !important; border-radius:0 !important }` +
        `.page-edge { display:none !important }` +
        // Screen affordances that would read as part of the document.
        `.signature-draggable { outline:none !important }` +
        `</style></head><body>${sheet.outerHTML}</body></html>`
    );
    doc.close();

    const go = () => {
      win.focus();
      win.print();
      window.setTimeout(() => frame.remove(), 1000);
    };
    if (doc.readyState === "complete") go();
    else frame.onload = go;
  }, [PAGE.css]);

  return (
    <Box>
      {controls ? (
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", pb: 1.5, flexWrap: "wrap" }}
          useFlexGap
        >
          <Select
            size="small"
            value={sizeKey}
            onChange={(event) => setSizeKey(event.target.value as PageSizeKey)}
            sx={{ "& .MuiSelect-select": { py: 0.4, fontSize: 13 } }}
          >
            {(Object.keys(PAGE_SIZES) as PageSizeKey[]).map((key) => (
              <MenuItem key={key} value={key} sx={{ fontSize: 13 }}>
                {PAGE_SIZES[key].name}
                <Box component="span" sx={{ ml: 1, color: "text.secondary", fontSize: 11 }}>
                  {PAGE_SIZES[key].width} × {PAGE_SIZES[key].height} mm
                </Box>
              </MenuItem>
            ))}
          </Select>
          <Typography variant="caption" color="text.secondary">
            {pages} {pages === 1 ? "page" : "pages"}
            {addedPages > 0 ? ` (${addedPages} added)` : ""}
          </Typography>

          <Box sx={{ flex: 1 }} />
          {actions}

          {/* A document often travels with a sheet left for signatures or a
              note at the receiving office, so the page count is not only a
              function of how much has been typed. */}
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => setAddedPages((count) => Math.min(count + 1, 20))}
          >
            Add page
          </Button>
          <Button
            size="small"
            startIcon={<RemoveIcon />}
            disabled={addedPages === 0}
            onClick={() => setAddedPages((count) => Math.max(count - 1, 0))}
          >
            Remove page
          </Button>
          <Button size="small" variant="outlined" startIcon={<PrintIcon />} onClick={handlePrint}>
            Print
          </Button>
        </Stack>
      ) : null}

      {/* The desk. A white sheet on a near-white application background has no
          visible edge, so where the paper stops and the screen carries on is a
          guess — and the margin, which is most of an A4, reads as empty screen
          rather than as part of the document. */}
      <Box
        sx={(theme) => ({
          height: `${PAGE.height * PX_PER_MM * pages * scale + 28}px`,
          overflow: "hidden",
          display: "flex",
          justifyContent: "center",
          p: "14px",
          borderRadius: 1.5,
          bgcolor: "#e4e6ea",
          border: "1px solid",
          borderColor: alpha("#000", 0.1),
          ...theme.applyStyles("dark", {
            backgroundColor: alpha("#000", 0.45),
            borderColor: alpha("#000", 0.5),
          }),
        })}
      >
        {/* Sized to the scaled result, because that is what the eye sees —
            `transform` does not affect layout, so without this the sheet would
            occupy its unscaled width and sit against one edge. */}
        <Box
          sx={{
            width: `${PAGE.width * PX_PER_MM * scale}px`,
            height: `${PAGE.height * PX_PER_MM * pages * scale}px`,
            flexShrink: 0,
          }}
        >
          <Box
            ref={sheetRef}
            className="print-sheet"
            sx={(theme) => ({
              // Paper white in both schemes, and its own ink. The one surface
              // that deliberately does not follow the theme: it represents a
              // physical page, and a letter on a dark grey sheet is not a letter.
              position: "relative",
              bgcolor: "#ffffff",
              color: "#16181d",
              borderRadius: 1,
              border: "1px solid",
              borderColor: alpha("#16181d", 0.28),
              boxShadow: `0 2px 4px ${alpha("#16181d", 0.12)},
                          0 18px 48px -20px ${alpha("#16181d", 0.5)}`,
              fontFamily: '"Georgia", "Times New Roman", serif',
              width: `${PAGE.width}mm`,
              minHeight: `${PAGE.height * pages}mm`,
              px: `${PAGE.margin}mm`,
              py: `${PAGE.margin}mm`,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              ...theme.applyStyles("dark", {}),
            })}
          >
            {/* Where each sheet ends. The document is one continuous flow
                rather than N elements, because splitting it would mean cutting
                a line of text in half, which looks like a rendering fault.
                These mark the fold; the browser fragments properly on print. */}
            {Array.from({ length: pages - 1 }, (_, index) => (
              <Box
                key={index}
                className="page-edge"
                aria-hidden
                sx={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: `${PAGE.height * (index + 1)}mm`,
                  borderTop: "1px dashed",
                  borderColor: alpha("#16181d", 0.22),
                  "&::after": {
                    content: `"page ${index + 2}"`,
                    position: "absolute",
                    right: 6,
                    top: 3,
                    fontSize: 9,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: alpha("#16181d", 0.35),
                  },
                }}
              />
            ))}

            <Box ref={flowRef}>{children}</Box>
            {overlays}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
