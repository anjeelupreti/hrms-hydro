"use client";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import type { ReactNode } from "react";

import DateText from "@/components/common/DateText";
import { RichText } from "@/components/common/RichTextEditor";
import StateChip from "@/components/common/StateChip";
import { MEMO_STATUS_TONE, type Memorandum } from "@/types/memoranda";

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
  };
}) {
  const subject = draft?.subject ?? memo?.subject ?? "";
  const content = draft?.content ?? memo?.content ?? "";
  const date = draft?.memo_date ?? memo?.memo_date ?? "";
  const company = draft?.companyName ?? memo?.company_name ?? "";
  const approver = draft?.approverName ?? memo?.approver_name ?? "";

  const through =
    draft?.throughNames ??
    (memo?.recommenders ?? []).map((row) => row.employee_name).filter(Boolean);

  const registration = [
    memo?.company_registration ? `Regd. ${memo.company_registration}` : "",
    memo?.company_pan ? `PAN ${memo.company_pan}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const contact = [memo?.company_phone, memo?.company_email].filter(Boolean).join(" · ");

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
              label={`With ${memo.current_holder_name}`}
              sx={{ bgcolor: "background.paper" }}
            />
          ) : null}
        </Stack>
      ) : null}

      <Box
        sx={(theme) => ({
          // Paper white in both schemes, and its own ink. This is the one
          // surface in the product that deliberately does not follow the theme:
          // it represents a physical page, and a letter on a dark grey sheet is
          // not a letter.
          bgcolor: "#ffffff",
          color: "#16181d",
          borderRadius: 1,
          border: "1px solid",
          borderColor: alpha(theme.palette.common.black, 0.14),
          boxShadow: `0 1px 2px ${alpha(theme.palette.common.black, 0.06)},
                      0 14px 40px -18px ${alpha(theme.palette.common.black, 0.35)}`,
          px: { xs: 3, sm: 6 },
          py: { xs: 3.5, sm: 5 },
          fontFamily: '"Georgia", "Times New Roman", serif',
        })}
      >
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
          <Box sx={{ textAlign: "center", minWidth: 0 }}>
            <Typography
              sx={{
                fontFamily: "inherit",
                fontWeight: 700,
                fontSize: { xs: "1.1rem", sm: "1.35rem" },
                letterSpacing: ".01em",
                lineHeight: 1.2,
              }}
            >
              {company || "—"}
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
            {date ? <DateText value={date} /> : <Muted>—</Muted>}
          </LetterLine>
        </Stack>

        {/* ── To / Through / From ────────────────────────────────────── */}
        <Stack spacing={0.9} sx={{ pb: 2 }}>
          <LetterLine label="To" width={70}>
            {approver ? (
              <>
                {approver}
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

          <LetterLine label="From" width={70}>
            {memo?.initiator_name ? (
              <>
                {memo.initiator_name}
                {memo.initiator_post ? `, ${memo.initiator_post}` : ""}
              </>
            ) : (
              <Muted>you</Muted>
            )}
          </LetterLine>
        </Stack>

        <Divider sx={{ borderColor: alpha("#16181d", 0.18) }} />

        {/* ── Subject ────────────────────────────────────────────────── */}
        <Box sx={{ py: 2 }}>
          <LetterLine label="Subject" width={70} bold>
            {subject || <Muted>—</Muted>}
          </LetterLine>
        </Box>

        <Divider sx={{ borderColor: alpha("#16181d", 0.18) }} />

        {/* ── The body ───────────────────────────────────────────────── */}
        <Box
          sx={{
            pt: 2.5,
            minHeight: 220,
            fontSize: ".95rem",
            lineHeight: 1.75,
            "& p": { margin: "0 0 .85em" },
            "& ul, & ol": { margin: "0 0 .85em", paddingLeft: "1.4em" },
            "& :last-child": { marginBottom: 0 },
          }}
        >
          {content ? <RichText html={content} /> : <Muted>Nothing written yet.</Muted>}
        </Box>

        {/* ── The foot of the page ───────────────────────────────────── */}
        {memo?.initiator_name ? (
          <Box sx={{ pt: 6, display: "flex", justifyContent: "flex-end" }}>
            <Box sx={{ textAlign: "center", minWidth: 210 }}>
              <Box sx={{ borderTop: "1px solid", borderColor: alpha("#16181d", 0.4), pt: 0.75 }}>
                <Typography sx={{ fontFamily: "inherit", fontSize: ".88rem", fontWeight: 600 }}>
                  {memo.initiator_name}
                </Typography>
                {memo.initiator_post ? (
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
