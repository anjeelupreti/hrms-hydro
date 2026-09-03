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
 * A memorandum, laid out as the sheet of paper it replaces.
 *
 * **Why it looks like a letter.** The people who write and sign these have
 * written and signed them on paper for years, and the form fields that replaced
 * them — a company dropdown, a date picker, a subject box stacked one above the
 * other — carry none of that. Somebody who has never used the system has to be
 * told what each control is for. A sheet with **Ref**, **Date**, **To**,
 * **From** and **Subject** in the places those things go on a letter needs no
 * telling: it is the document they already know, and the only new thing to
 * learn is where to click.
 *
 * It is also what gets printed and filed. A screen that looks like the printout
 * removes the moment of doubt about whether the two are the same document.
 *
 * **The status is not on the paper.** A real memorandum does not carry a chip
 * reading "in progress" — that is something the *system* knows about the
 * document, not something the document says. It sits on a tab clipped to the
 * top-right corner, outside the sheet's own margins, so the letter stays a
 * letter and the workflow state is still the first thing the eye lands on.
 */
export default function MemorandumLetter({
  memo,
  /** Draft values, so the paper reads correctly before anything is saved. */
  draft,
  /**
   * Controls to render *in place of* a printed value.
   *
   * **This is what makes it a form somebody already knows how to use.** The
   * alternative — a stack of labelled fields above a preview — is two documents
   * and asks the reader to map one onto the other. Putting the company picker
   * where the letterhead goes, and the subject box on the subject line, means
   * filling this in is filling in the letter.
   *
   * A slot that is not supplied prints its value instead, which is how the same
   * component serves a draft being written and a decided memorandum nobody may
   * touch.
   */
  slots,
}: {
  memo: Memorandum | null;
  draft?: {
    subject?: string;
    content?: string;
    memo_date?: string;
    companyName?: string | null;
    approverName?: string | null;
  };
  slots?: {
    company?: ReactNode;
    date?: ReactNode;
    to?: ReactNode;
    subject?: ReactNode;
    body?: ReactNode;
  };
}) {
  const subject = draft?.subject ?? memo?.subject ?? "";
  const content = draft?.content ?? memo?.content ?? "";
  const date = draft?.memo_date ?? memo?.memo_date ?? "";
  const company = draft?.companyName ?? memo?.company_name ?? "";
  const approver = draft?.approverName ?? memo?.approver_name ?? "";

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
          // Paper white in both schemes. A letter on a dark grey sheet is not a
          // letter, and this is the one surface in the product that is
          // deliberately not theme-following: it represents a physical page.
          bgcolor: "#ffffff",
          color: "#16181d",
          borderRadius: 1,
          border: "1px solid",
          borderColor: alpha(theme.palette.common.black, 0.14),
          boxShadow: `0 1px 2px ${alpha(theme.palette.common.black, 0.06)},
                      0 14px 40px -18px ${alpha(theme.palette.common.black, 0.35)}`,
          px: { xs: 3, sm: 6 },
          py: { xs: 3.5, sm: 5 },
          // A serif body, because that is what these are typed in.
          fontFamily: '"Georgia", "Times New Roman", serif',
        })}
      >
        {/* ── Letterhead ─────────────────────────────────────────────── */}
        <Box sx={{ textAlign: "center", pb: 2 }}>
          {slots?.company ? (
            <Box sx={{ maxWidth: 420, mx: "auto", mb: 1 }}>{slots.company}</Box>
          ) : (
            <Typography
              sx={{
                fontFamily: "inherit",
                fontWeight: 700,
                fontSize: { xs: "1.05rem", sm: "1.25rem" },
                letterSpacing: ".01em",
                lineHeight: 1.25,
              }}
            >
              {company || "—"}
            </Typography>
          )}
          {memo?.company_address ? (
            <Typography sx={{ fontFamily: "inherit", fontSize: ".82rem", color: "#5a6070" }}>
              {memo.company_address}
            </Typography>
          ) : null}
          <Typography
            sx={{
              fontFamily: "inherit",
              mt: 1.5,
              fontWeight: 700,
              letterSpacing: ".22em",
              fontSize: ".82rem",
              textTransform: "uppercase",
            }}
          >
            Memorandum
          </Typography>
        </Box>

        <Divider sx={{ borderColor: alpha("#16181d", 0.35), borderBottomWidth: 2 }} />

        {/* ── Ref and Date, the way a letter carries them ────────────── */}
        <Stack
          direction={{ xs: "column", sm: "row" }}
          sx={{ justifyContent: "space-between", gap: 0.5, pt: 2, pb: 1.5 }}
        >
          <LetterLine label="Ref" width={44}>
            {memo?.memo_id ?? (
              <Muted>issued when this is submitted</Muted>
            )}
          </LetterLine>
          <LetterLine label="Date" width={52}>
            {slots?.date ?? (date ? <DateText value={date} /> : <Muted>—</Muted>)}
          </LetterLine>
        </Stack>

        {/* ── To / From ──────────────────────────────────────────────── */}
        <Stack spacing={0.75} sx={{ pb: 1.5 }}>
          <LetterLine label="To" width={60}>
            {slots?.to ??
              (approver ? (
                <>
                  {approver}
                  {memo?.approver_post ? `, ${memo.approver_post}` : ""}
                </>
              ) : (
                <Muted>no approver chosen yet</Muted>
              ))}
          </LetterLine>
          <LetterLine label="From" width={60}>
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
        <Box sx={{ py: 1.75 }}>
          <LetterLine label="Subject" width={72} bold>
            {slots?.subject ?? (subject || <Muted>—</Muted>)}
          </LetterLine>
        </Box>

        <Divider sx={{ borderColor: alpha("#16181d", 0.18) }} />

        {/* ── The body ───────────────────────────────────────────────── */}
        <Box
          sx={{
            pt: 2.5,
            minHeight: 180,
            fontSize: ".95rem",
            lineHeight: 1.7,
            "& p": { margin: "0 0 .85em" },
            "& ul, & ol": { margin: "0 0 .85em", paddingLeft: "1.4em" },
            "& :last-child": { marginBottom: 0 },
          }}
        >
          {slots?.body ??
            (content ? <RichText html={content} /> : <Muted>Nothing written yet.</Muted>)}
        </Box>

        {/* ── The foot of the page ───────────────────────────────────── */}
        {memo?.initiator_name ? (
          <Box sx={{ pt: 5, display: "flex", justifyContent: "flex-end" }}>
            <Box sx={{ textAlign: "center", minWidth: 200 }}>
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
 * A fixed label width rather than a table: it is what makes To, From and
 * Subject line up down the page the way a typed letter does, and a table for
 * five rows brings a lot of markup for one alignment.
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
          // `flex: 1` so a slot can fill the line. Without it the value is a
          // shrink-to-fit inline span, and the subject box was cut off after
          // twenty characters — you could not read what you had just typed.
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
