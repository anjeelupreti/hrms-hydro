"use client";

import AddIcon from "@mui/icons-material/Add";
import PrintIcon from "@mui/icons-material/Print";
import RemoveIcon from "@mui/icons-material/Remove";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import DateText from "@/components/common/DateText";
import { withCode } from "@/lib/people";
import { RichText } from "@/components/common/RichTextEditor";
import StateChip from "@/components/common/StateChip";
import { MEMO_STATUS_TONE, type Memorandum, type MemorandumEvent } from "@/types/memoranda";

/**
 * The paper, in millimetres, because that is the unit it is sold in.
 *
 * The letter is going to be printed, so the preview is laid out at the real
 * size rather than at whatever width the dialog happens to be: it is scaled
 * down to fit on screen (see `scale`) and printed at 1:1. That is what makes
 * the line breaks on screen the line breaks on paper.
 *
 * **A4 first, because that is what the office has in the tray.** The rest are
 * here because a letter is not always a letter: an annual statement goes on
 * Legal, a drawing schedule or a wide table goes on A3, and a short note reads
 * better on A5. `name` is what goes in the menu — a ream is labelled "Legal",
 * not "215.9 × 355.6".
 *
 * 18mm of margin is the usual for a letterhead: enough for a punch hole on the
 * left and a file stamp at the foot without crowding the text. A3 is given more
 * because a margin that looks generous on A4 looks like an accident on a sheet
 * twice the size.
 */
const PAGE_SIZES = {
  a4: { name: "A4", width: 210, height: 297, margin: 18, css: "A4" },
  a5: { name: "A5", width: 148, height: 210, margin: 14, css: "A5" },
  a3: { name: "A3", width: 297, height: 420, margin: 24, css: "A3" },
  letter: { name: "Letter", width: 215.9, height: 279.4, margin: 18, css: "Letter" },
  legal: { name: "Legal", width: 215.9, height: 355.6, margin: 18, css: "Legal" },
} as const;

type PageSizeKey = keyof typeof PAGE_SIZES;

/** CSS millimetres are defined against 96dpi, so this is exact, not a guess. */
const PX_PER_MM = 96 / 25.4;

/**
 * A memorandum, as the sheet of paper it replaces.
 *
 * **Read-only, always.** It used to carry the form controls in the places their
 * values would print — the company picker as the letterhead, the editor as the
 * body — which read well as an idea and badly on screen: a rich-text toolbar
 * inside a white page inherits the page's serif and its ink, so the controls
 * washed out against the paper and the thing meant to look like a document
 * looked like a form wearing one. Composing happens in a column beside the page
 * now, and this renders what has been written, live. The page is a page.
 *
 * **Three routing lines, not two.** `To` is the approver, `Through` is every
 * recommender in the order they see it, `From` is whoever raised it. Through is
 * how a memorandum is actually addressed here — it goes *through* the chain to
 * reach the person who can decide — and leaving it off made the recommenders
 * invisible on the document they sign.
 *
 * **Nothing reading "MEMORANDUM" across the top.** The letterhead says whose
 * paper this is and the Ref line says what it is; a word in capitals between
 * them is what a template generator adds and a typist never would.
 */
export default function MemorandumLetter({
  memo,
  /** Draft values, so the page reads correctly before anything is saved. */
  draft,
  printable = false,
  body,
  fields,
  history,
}: {
  memo: Memorandum | null;
  draft?: {
    subject?: string;
    content?: string;
    memo_date?: string;
    companyName?: string | null;
    approverName?: string | null;
    /** Names in chain order, for the Through line while it is being chosen. */
    throughNames?: string[];
    /**
     * The signed-in person, for the From line before anything is saved.
     *
     * A blank letter that says "From: you" is a form talking about itself. The
     * point of this page is that somebody who has written memoranda on paper
     * for thirty years recognises it, and on paper the From line already has
     * their name in it before they start — so it is shown here too, greyed,
     * the way a pencilled name is. Nothing is stored until they save; this is
     * the page telling them what it is going to say.
     */
    fromName?: string | null;
  };
  /**
   * Show the page controls — the page count, add/remove a blank sheet, print.
   *
   * Off by default so the letter stays a plain read-only rendering wherever it
   * is embedded (the list preview, the history view) and only carries controls
   * where somebody is actually working on it.
   */
  printable?: boolean;
  /**
   * Editors placed *in the letter*, where the values they set appear.
   *
   * **One place to look, not two.** Company, date and subject used to be typed
   * into a form in the right-hand rail and read back off the page beside it,
   * which is a live preview — a thing that shows you the consequence of an edit
   * somewhere else. For anybody who has filled in a paper form for thirty
   * years that is a strange machine. Filling in the blanks on the form itself
   * is the machine they already know.
   *
   * Each is a node rather than a value plus a callback: the letter should not
   * have to know what a company picker is, only where the company goes.
   */
  fields?: {
    company?: ReactNode;
    date?: ReactNode;
    subject?: ReactNode;
  };
  /**
   * The action log, printed on the page rather than beside it.
   *
   * A memorandum's history *is* part of the document here: who recommended it,
   * when, with what comment and against which attachment is exactly what the
   * approver is reading before they sign, and what an auditor opens the file
   * for afterwards. Off the page it does not travel with the printed copy.
   */
  history?: MemorandumEvent[];
  /**
   * The writing surface, when the memorandum is being written *on the page*.
   *
   * Given, this replaces the rendered content in the body — so the author types
   * where the words will print rather than into a box beside a preview of
   * them. Omitted, the page renders what has been saved, which is what every
   * read-only use of this component wants.
   */
  body?: ReactNode;
}) {
  const subject = draft?.subject ?? memo?.subject ?? "";
  const content = draft?.content ?? memo?.content ?? "";
  const date = draft?.memo_date ?? memo?.memo_date ?? "";
  const company = draft?.companyName ?? memo?.company_name ?? "";
  const approver = draft?.approverName ?? memo?.approver_name ?? "";

  const through =
    draft?.throughNames ??
    (memo?.recommenders ?? [])
      .map((row) => withCode(row.employee_name, row.employee_code))
      .filter(Boolean);

  const registration = [
    memo?.company_registration ? `Regd. ${memo.company_registration}` : "",
    memo?.company_pan ? `PAN ${memo.company_pan}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const contact = [memo?.company_phone, memo?.company_email].filter(Boolean).join(" · ");

  /**
   * Everybody whose mark belongs on this page, in the order it was collected.
   *
   * Recommenders who have acted, then the approver once they have decided. The
   * initiator is not here: their name is already at the foot as the author, and
   * repeating it as a signatory would suggest they approved their own request.
   */
  const signed = [
    ...(memo?.recommenders ?? [])
      .filter((row) => row.has_acted)
      .map((row) => ({
        key: `r-${row.id}`,
        name: withCode(row.employee_name, row.employee_code),
        role: row.designation || "Recommended",
        signature: row.signature,
      })),
    ...(memo?.status === "approved" && memo.approver_name
      ? [
          {
            key: "approver",
            name: withCode(memo.approver_name, memo.approver_code),
            role: memo.approver_post || "Approved",
            signature: memo.approver_signature,
          },
        ]
      : []),
  ];

  const [sizeKey, setSizeKey] = useState<PageSizeKey>("a4");
  const PAGE = PAGE_SIZES[sizeKey];
  const contentHeightPx = (PAGE.height - PAGE.margin * 2) * PX_PER_MM;

  const sheetRef = useRef<HTMLDivElement | null>(null);
  const flowRef = useRef<HTMLDivElement | null>(null);
  const [naturalPages, setNaturalPages] = useState(1);
  const [addedPages, setAddedPages] = useState(0);
  const [scale, setScale] = useState(1);

  /**
   * How many A4 sheets the writing actually fills.
   *
   * Measured rather than declared: the author is typing into a box beside this
   * one, and the page count has to answer to what they have written. Whole
   * pages only — half a sheet of A4 is still a sheet of A4.
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
  }, [content, subject, through.length, company, contentHeightPx]);

  /**
   * Shrink the sheet to whatever width it has been given.
   *
   * The page is laid out at 210mm and 210mm does not fit in half a dialog, so
   * it is scaled rather than reflowed — reflowing would mean the line breaks on
   * screen were not the line breaks on paper, which defeats the point of
   * previewing at all.
   */
  useEffect(() => {
    const node = sheetRef.current?.parentElement;
    if (!node || typeof ResizeObserver === "undefined") return;
    const fit = () => {
      // The content box, not `clientWidth` — that includes the desk's padding,
      // so the sheet was scaled to the full width and then drawn inside the
      // padding, overhanging the desk on one side.
      const style = window.getComputedStyle(node);
      const available =
        node.clientWidth - parseFloat(style.paddingLeft || "0") - parseFloat(style.paddingRight || "0");
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
   * Print through a window of its own.
   *
   * The alternative is a print stylesheet that hides the rest of the
   * application, and "the rest of the application" here is a dialog inside a
   * scrolling page inside a sidebar layout — every one of which contributes a
   * clip or an overflow that turns up on paper. Copying the stylesheets into a
   * blank window and printing that gives the letter the whole sheet, which is
   * what it is drawn for.
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
     * The page's styles, read out of the CSSOM rather than off the DOM.
     *
     * **`outerHTML` on the `<style>` tags is not enough and looks like it is.**
     * In a production build Emotion inserts rules with `sheet.insertRule` for
     * speed, which leaves the `<style>` elements present but empty — copying
     * their markup yields a head full of nothing. The printed letter came out
     * with its typography roughly right (inherited and inline styles survive)
     * and every flex row collapsed: "Ref:" and its value ran together, the
     * letterhead lost its centring, and the double rule under it stacked into
     * four lines. It read as the layout being wrong rather than as the
     * stylesheet being absent.
     *
     * Cross-origin sheets throw on `cssRules` and cannot be read at all, so
     * those are re-linked by href and left to the print window to fetch.
     */
    const head = Array.from(document.styleSheets)
      .map((sheet) => {
        try {
          return `<style>${Array.from(sheet.cssRules)
            .map((rule) => rule.cssText)
            .join("\n")}</style>`;
        } catch {
          return sheet.href ? `<link rel="stylesheet" href="${sheet.href}">` : "";
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
        `</style></head><body>${sheet.outerHTML}</body></html>`
    );
    doc.close();

    const go = () => {
      win.focus();
      win.print();
      // Left in place until the dialog closes; removing it synchronously can
      // cancel the print job in some browsers.
      window.setTimeout(() => frame.remove(), 1000);
    };
    if (doc.readyState === "complete") go();
    else frame.onload = go;
  }, [PAGE.css]);

  return (
    <Box sx={{ position: "relative" }}>
      {/* The state, clipped to the corner rather than printed on the page. */}
      {memo ? (
        <Stack
          direction="row"
          spacing={0.75}
          sx={{
            position: "absolute",
            top: -12,
            right: 0,
            zIndex: 2,
            alignItems: "center",
            flexWrap: "wrap",
          }}
          useFlexGap
        >
          <StateChip label={memo.status_display} tone={MEMO_STATUS_TONE[memo.status]} />
          {memo.current_holder_name ? (
            <Chip
              size="small"
              variant="outlined"
              label={`With ${withCode(memo.current_holder_name, memo.current_holder_code)}`}
              sx={{ bgcolor: "background.paper" }}
            />
          ) : null}
        </Stack>
      ) : null}

      {printable ? (
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
          {/* **Adding a blank page on purpose.** A memorandum often travels
              with a sheet left for signatures, endorsements or a hand-written
              note at the receiving office — so the page count is not only a
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

      {/* **A desk for the paper to sit on.**

          A white sheet on the near-white application background had nothing to
          separate them: the page had no visible edge, so where the paper
          stopped and the screen carried on was a guess — and the margin, which
          is most of an A4, read as empty screen rather than as part of the
          document. A slightly darker ground behind it and a real edge on the
          sheet make it a piece of paper again. Dark in both schemes for the
          same reason a light box would not work on a dark theme.

          Also the scaling wrapper: `transform` does not affect layout, so the
          height is restated here — without it the surrounding column would size
          itself to the unscaled sheet and leave a long gap underneath. */}
      <Box
        sx={(theme) => ({
          height: printable
            ? `${PAGE.height * PX_PER_MM * pages * scale + (printable ? 28 : 0)}px`
            : undefined,
          overflow: "hidden",
          ...(printable
            ? {
                // **Centred, not left-aligned.** `transform: scale` does not
                // affect layout, so the sheet still occupies its unscaled
                // 210mm and sat against the left edge of whatever column it was
                // in — with the desk running on beside it. Centring the scaled
                // box puts the paper in the middle of the desk, which is where
                // paper goes.
                display: "flex",
                justifyContent: "center",
                p: "14px",
                borderRadius: 1.5,
                // 🔒 **`theme.palette.mode` is a lie under this theme.** It is
                // built with `cssVariables` + `colorSchemes`, so `mode` stays
                // whatever it was at creation and never reports "dark" — a
                // branch on it renders the light arm forever. `applyStyles`
                // emits a rule under the dark selector instead.
                bgcolor: "#e4e6ea",
                border: "1px solid",
                borderColor: alpha("#000", 0.1),
                ...theme.applyStyles("dark", {
                  // Darker than the dialog behind it, so the sheet reads as
                  // paper lying on something rather than as a floating slab.
                  backgroundColor: alpha("#000", 0.45),
                  borderColor: alpha("#000", 0.5),
                }),
              }
            : {}),
        })}
      >
      <Box
        // Sized to the scaled result, because that is what the eye sees. The
        // sheet inside keeps its true millimetres and is scaled into this.
        sx={
          printable
            ? {
                width: `${PAGE.width * PX_PER_MM * scale}px`,
                height: `${PAGE.height * PX_PER_MM * pages * scale}px`,
                flexShrink: 0,
              }
            : undefined
        }
      >
      <Box
        ref={sheetRef}
        className="print-sheet"
        sx={(theme) => ({
          // Paper white in both schemes, and its own ink. This is the one
          // surface in the product that deliberately does not follow the theme:
          // it represents a physical page, and a letter on a dark grey sheet is
          // not a letter.
          bgcolor: "#ffffff",
          color: "#16181d",
          borderRadius: 1,
          // A visible edge, not a hint of one. This was `black 0.14` with a
          // soft shadow, which is invisible against a light background — the
          // whole point of the border is to say where the paper ends.
          border: "1px solid",
          borderColor: alpha("#16181d", 0.28),
          boxShadow: `0 2px 4px ${alpha("#16181d", 0.12)},
                      0 18px 48px -20px ${alpha("#16181d", 0.5)}`,
          fontFamily: '"Georgia", "Times New Roman", serif',
          // **A4, at its real size.** The sheet is laid out in millimetres and
          // then scaled to fit the column, rather than being given the column's
          // width — so a line that wraps here wraps in the same place on paper.
          ...(printable
            ? {
                position: "relative",
                width: `${PAGE.width}mm`,
                minHeight: `${PAGE.height * pages}mm`,
                px: `${PAGE.margin}mm`,
                py: `${PAGE.margin}mm`,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }
            : { px: { xs: 3, sm: 6 }, py: { xs: 3.5, sm: 5 } }),
        })}
      >
        {/* Where each sheet ends.

            The letter is one continuous flow rather than N separate elements,
            because splitting it would mean choosing where to cut a paragraph
            and cutting a line of text in half looks like a rendering fault.
            These mark the fold instead: the reader can see what lands on page
            two, and the browser does the real fragmentation when it prints. */}
        {printable
          ? Array.from({ length: pages - 1 }, (_, index) => (
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
            ))
          : null}

        <Box ref={flowRef}>
        {/* ── Letterhead ─────────────────────────────────────────────────
            The mark, the name, the seat, then the registration line. The logo
            sits left of the name when there is one and the block centres when
            there is not, because a centred block with an empty square beside it
            reads as a broken image. */}
        <Stack
          direction="row"
          spacing={2.5}
          sx={{ alignItems: "center", justifyContent: "center", pb: 2 }}
        >
          {memo?.company_logo ? (
            <Box
              component="img"
              src={memo.company_logo}
              alt=""
              sx={{ width: 62, height: 62, objectFit: "contain", flexShrink: 0 }}
            />
          ) : null}
          <Box sx={{ textAlign: "center", minWidth: 0, flex: fields?.company ? 1 : "0 1 auto" }}>
            <Typography
              sx={{
                fontFamily: "inherit",
                fontWeight: 700,
                fontSize: { xs: "1.1rem", sm: "1.35rem" },
                letterSpacing: ".01em",
                lineHeight: 1.2,
              }}
            >
              {fields?.company ?? (company || "—")}
            </Typography>
            {/* **What the document is, under whose paper it is on.**

                Deliberately small and under the name rather than a banner
                across the top. A letterhead names the organisation; the word
                that says which kind of document this is belongs beneath it, in
                the size a printed form uses — large capitals across the head of
                the page is what a template generator produces and a typist
                never would. */}
            <Typography
              sx={{
                fontFamily: "inherit",
                fontSize: ".68rem",
                fontWeight: 700,
                letterSpacing: ".22em",
                textTransform: "uppercase",
                color: "#5a6070",
                mt: 0.4,
              }}
            >
              Memorandum
            </Typography>
            {memo?.company_address ? (
              <Typography
                sx={{ fontFamily: "inherit", fontSize: ".84rem", color: "#4d5462", mt: 0.25 }}
              >
                {memo.company_address}
              </Typography>
            ) : null}
            {registration || contact ? (
              <Typography
                sx={{ fontFamily: "inherit", fontSize: ".72rem", color: "#7b8291", mt: 0.25 }}
              >
                {[registration, contact].filter(Boolean).join("  |  ")}
              </Typography>
            ) : null}
          </Box>
        </Stack>

        {/* A double rule under a letterhead: it separates whose paper this is
            from what is written on it, and one line does not carry that. */}
        <Divider sx={{ borderColor: alpha("#16181d", 0.5), borderBottomWidth: 2 }} />
        <Divider sx={{ borderColor: alpha("#16181d", 0.5), mt: "2px" }} />

        {/* ── Ref and Date ───────────────────────────────────────────── */}
        <Stack
          direction={{ xs: "column", sm: "row" }}
          sx={{ justifyContent: "space-between", gap: 0.5, pt: 2.5, pb: 2 }}
        >
          <LetterLine label="Ref" width={70}>
            {memo?.memo_id ?? <Muted>issued when this is submitted</Muted>}
          </LetterLine>
          <LetterLine label="Date" width={54}>
            {fields?.date ?? (date ? <DateText value={date} /> : <Muted>—</Muted>)}
          </LetterLine>
        </Stack>

        {/* ── To / Through / From ────────────────────────────────────── */}
        <Stack spacing={0.9} sx={{ pb: 2 }}>
          <LetterLine label="To" width={70}>
            {approver ? (
              <>
                {withCode(approver, memo?.approver_code)}
                {memo?.approver_post ? `, ${memo.approver_post}` : ""}
              </>
            ) : (
              <Muted>no approver chosen yet</Muted>
            )}
          </LetterLine>

          {/* Only once somebody is in it. An empty Through line on a
              memorandum that genuinely has no recommenders is a blank the
              reader has to interpret. */}
          {through.length > 0 ? (
            <LetterLine label="Through" width={70}>
              <Box component="span" sx={{ display: "block" }}>
                {through.map((name, index) => (
                  <Box component="span" key={`${name}-${index}`} sx={{ display: "block" }}>
                    {through.length > 1 ? `${index + 1}. ` : ""}
                    {name}
                  </Box>
                ))}
              </Box>
            </LetterLine>
          ) : null}

          {/* **Status and holder belong on the page.** They were chips clipped
              to the corner of the preview, which is a screen decoration — it
              does not print, and the printed copy is the one that gets filed.
              A reader picking the paper out of a folder has to be able to see
              whether it was ever decided and who had it last. */}
          {memo ? (
            <LetterLine label="Status" width={70}>
              <Box component="span" sx={{ fontWeight: 700 }}>
                {memo.status_display}
              </Box>
              {memo.current_holder_name ? (
                <Box component="span" sx={{ color: "#5a6070" }}>
                  {" — with "}
                  {withCode(memo.current_holder_name, memo.current_holder_code)}
                </Box>
              ) : null}
            </LetterLine>
          ) : null}

          <LetterLine label="From" width={70}>
            {memo?.initiator_name ? (
              <>
                {withCode(memo.initiator_name, memo.initiator_code)}
                {memo.initiator_post ? `, ${memo.initiator_post}` : ""}
              </>
            ) : draft?.fromName ? (
              <Muted>{draft.fromName}</Muted>
            ) : (
              <Muted>you</Muted>
            )}
          </LetterLine>
        </Stack>

        <Divider sx={{ borderColor: alpha("#16181d", 0.18) }} />

        {/* ── Subject ────────────────────────────────────────────────── */}
        <Box sx={{ py: 2 }}>
          <LetterLine label="Subject" width={70} bold>
            {fields?.subject ?? (subject || <Muted>—</Muted>)}
          </LetterLine>
        </Box>

        <Divider sx={{ borderColor: alpha("#16181d", 0.18) }} />

        {/* ── The body ───────────────────────────────────────────────── */}
        <Box
          sx={{
            pt: 2.5,
            // Enough of the sheet to be clickable. Writing happens in here, and
            // a body sized to its own text leaves most of page one inert — you
            // click where you want to carry on and nothing takes the caret.
            minHeight: body ? `${(PAGE.height - PAGE.margin * 2) * 0.62}mm` : 220,
            fontSize: ".95rem",
            lineHeight: 1.75,
            "& p": { margin: "0 0 .85em" },
            "& ul, & ol": { margin: "0 0 .85em", paddingLeft: "1.4em" },
            "& :last-child": { marginBottom: 0 },
          }}
        >
          {body ?? (content ? <RichText html={content} /> : <Muted>Nothing written yet.</Muted>)}
        </Box>

        {/* ── What happened to it ────────────────────────────────────
            On the page, in a table, because on this document the history *is*
            content: who recommended it, when, with what remark and against
            which attachment is what the approver reads before signing and what
            an auditor opens the file for afterwards. Beside the page it does
            not travel with the printed copy. */}
        {history && history.length > 0 ? (
          <Box sx={{ pt: 4 }}>
            <Typography
              sx={{
                fontFamily: "inherit",
                fontSize: ".7rem",
                fontWeight: 700,
                letterSpacing: ".14em",
                textTransform: "uppercase",
                color: "#5a6070",
                pb: 0.75,
              }}
            >
              Actions
            </Typography>
            <Box
              component="table"
              sx={{
                width: "100%",
                borderCollapse: "collapse",
                tableLayout: "fixed",
                fontSize: ".78rem",
                "& th, & td": {
                  border: "1px solid #9aa0a6",
                  padding: "5px 7px",
                  verticalAlign: "top",
                  textAlign: "left",
                },
                "& th": { backgroundColor: "#f1f3f4", fontWeight: 700 },
              }}
            >
              <Box component="thead">
                <Box component="tr">
                  <Box component="th" sx={{ width: "22%" }}>Date &amp; time</Box>
                  <Box component="th" sx={{ width: "24%" }}>User</Box>
                  <Box component="th" sx={{ width: "18%" }}>Action</Box>
                  <Box component="th">Comment</Box>
                  <Box component="th" sx={{ width: "18%" }}>Attachments</Box>
                </Box>
              </Box>
              <Box component="tbody">
                {history.map((event) => (
                  <Box component="tr" key={event.id}>
                    <Box component="td">
                      {/* The time as well as the day. Two recommendations on the
                          same afternoon are indistinguishable without it, and
                          the order they happened in is the whole point. */}
                      <DateText value={event.created_at} withTime />
                    </Box>
                    <Box component="td">{event.actor_label}</Box>
                    <Box component="td">{event.action_label || event.kind_display}</Box>
                    <Box component="td">{event.comment || "—"}</Box>
                    <Box component="td">
                      {/* The caption when there is one, otherwise the file's
                          own name off the end of its path — which is what
                          somebody who attached it will recognise. */}
                      {event.attachments.length > 0
                        ? event.attachments
                            .map((file) => file.caption || file.file.split("/").pop() || "file")
                            .join(", ")
                        : "—"}
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        ) : null}

        {/* ── Who signed it ──────────────────────────────────────────
            The recommenders, in the order they saw it, with their signatures
            where they have acted. **This is the block the whole signature
            apparatus exists for**: a printed memorandum is only a record of who
            recommended it if their marks are on the paper, and a name in a list
            is not a mark. Somebody who has acted without an approved signature
            still appears — the fact that they recommended it is true whether or
            not they ever uploaded an image. */}
        {signed.length > 0 ? (
          <Box sx={{ pt: 4 }}>
            <Stack direction="row" sx={{ flexWrap: "wrap", gap: 3 }} useFlexGap>
              {signed.map((person) => (
                <Box key={person.key} sx={{ minWidth: 170 }}>
                  <Box
                    sx={{
                      height: 44,
                      display: "flex",
                      alignItems: "flex-end",
                      mb: 0.25,
                    }}
                  >
                    {person.signature ? (
                      <Box
                        component="img"
                        src={person.signature}
                        alt=""
                        sx={{ maxHeight: 44, maxWidth: 170, objectFit: "contain" }}
                      />
                    ) : null}
                  </Box>
                  <Box sx={{ borderTop: "1px solid", borderColor: alpha("#16181d", 0.4), pt: 0.5 }}>
                    <Typography sx={{ fontFamily: "inherit", fontSize: ".8rem", fontWeight: 600 }}>
                      {person.name}
                    </Typography>
                    <Typography sx={{ fontFamily: "inherit", fontSize: ".7rem", color: "#5a6070" }}>
                      {person.role}
                    </Typography>
                  </Box>
                </Box>
              ))}
            </Stack>
          </Box>
        ) : null}

        {/* ── The foot of the page ───────────────────────────────────── */}
        {memo?.initiator_name || draft?.fromName ? (
          <Box sx={{ pt: 6, display: "flex", justifyContent: "flex-end" }}>
            <Box sx={{ textAlign: "center", minWidth: 210 }}>
              <Box sx={{ borderTop: "1px solid", borderColor: alpha("#16181d", 0.4), pt: 0.75 }}>
                <Typography
                  sx={{
                    fontFamily: "inherit",
                    fontSize: ".88rem",
                    fontWeight: 600,
                    // Greyed until it is real, matching the From line.
                    color: memo?.initiator_name ? "inherit" : "#9aa1ae",
                  }}
                >
                  {memo?.initiator_name
                    ? withCode(memo.initiator_name, memo.initiator_code)
                    : draft?.fromName}
                </Typography>
                {memo?.initiator_post ? (
                  <Typography sx={{ fontFamily: "inherit", fontSize: ".78rem", color: "#5a6070" }}>
                    {memo.initiator_post}
                  </Typography>
                ) : null}
              </Box>
            </Box>
          </Box>
        ) : null}
        </Box>
      </Box>
      </Box>
      </Box>
    </Box>
  );
}

/**
 * One `Label: value` line, with the labels aligned into a column.
 *
 * A fixed label width rather than a table: it is what makes To, Through, From
 * and Subject line up down the page the way a typed letter does, and a table
 * for five rows is a lot of markup for one alignment.
 */
function LetterLine({
  label,
  children,
  width,
  bold = false,
}: {
  label: string;
  children: ReactNode;
  width: number;
  bold?: boolean;
}) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
      <Typography
        component="span"
        sx={{
          fontFamily: "inherit",
          fontWeight: 700,
          fontSize: ".9rem",
          minWidth: width,
          flexShrink: 0,
        }}
      >
        {label}:
      </Typography>
      <Typography
        component="span"
        sx={{
          fontFamily: "inherit",
          fontSize: ".9rem",
          fontWeight: bold ? 700 : 400,
          flex: 1,
          minWidth: 0,
          wordBreak: "break-word",
        }}
      >
        {children}
      </Typography>
    </Stack>
  );
}

/** A placeholder that reads as absent rather than as content. */
function Muted({ children }: { children: ReactNode }) {
  return (
    <Box component="span" sx={{ color: "#8b91a1", fontStyle: "italic" }}>
      {children}
    </Box>
  );
}
