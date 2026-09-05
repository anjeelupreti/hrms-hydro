"use client";

import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import type { ReactNode } from "react";

import DateText from "@/components/common/DateText";
import PaperSheet from "@/components/common/PaperSheet";
import { RichText } from "@/components/common/RichTextEditor";
import { withCode } from "@/lib/people";
import type { MeetingDecision, MeetingMinutes } from "@/types/meetings";

/**
 * The minute of a meeting, as the sheet of paper it replaces.
 *
 * **The heading is the facts of the meeting, not a letterhead.** A memorandum
 * is addressed — it needs To, Through and From. A minute is not addressed to
 * anybody; it records that a meeting happened, so what belongs at the top is
 * whose meeting, which meeting, and when and where it was. Somebody pulling
 * this out of a folder in two years needs those four things before anything
 * else.
 *
 * **Blanks, filled in.** Date, time, location and duration are laid out as a
 * form with the values written into it, the same way the memorandum's Ref and
 * Subject lines are — because that is the document these people already know
 * how to read.
 *
 * The consent register closes it. `build_minutes_body` leaves a marker where
 * it goes rather than rendering it, because it needs the signature images, and
 * those are files rather than text.
 */
export default function MinutesSheet({
  minute,
  decisions,
  /** The editable body, when the minute is being written. Omitted, the saved
   *  content is rendered instead. */
  body,
  actions,
}: {
  minute: MeetingMinutes;
  decisions: MeetingDecision[];
  body?: ReactNode;
  actions?: ReactNode;
}) {
  const duration = formatDuration(minute.duration_minutes);

  return (
    <PaperSheet actions={actions}>
      {/* ── Whose paper, and what this is ───────────────────────────── */}
      <Stack direction="row" spacing={2.5} sx={{ alignItems: "center", justifyContent: "center", pb: 1.5 }}>
        {minute.company_logo ? (
          <Box
            component="img"
            src={minute.company_logo}
            alt=""
            sx={{ width: 58, height: 58, objectFit: "contain", flexShrink: 0 }}
          />
        ) : null}
        <Box sx={{ textAlign: "center", minWidth: 0 }}>
          <Typography
            sx={{
              fontFamily: "inherit",
              fontWeight: 700,
              fontSize: { xs: "1.05rem", sm: "1.3rem" },
              lineHeight: 1.2,
            }}
          >
            {minute.company_name || "—"}
          </Typography>
          {minute.company_address ? (
            <Typography sx={{ fontFamily: "inherit", fontSize: ".8rem", color: "#4d5462", mt: 0.25 }}>
              {minute.company_address}
            </Typography>
          ) : null}
          <Typography
            sx={{
              fontFamily: "inherit",
              fontSize: ".7rem",
              fontWeight: 700,
              letterSpacing: ".22em",
              textTransform: "uppercase",
              color: "#5a6070",
              mt: 0.5,
            }}
          >
            Minute of meeting
          </Typography>
        </Box>
      </Stack>

      <Divider sx={{ borderColor: alpha("#16181d", 0.5), borderBottomWidth: 2 }} />
      <Divider sx={{ borderColor: alpha("#16181d", 0.5), mt: "2px" }} />

      {/* ── The blanks ──────────────────────────────────────────────── */}
      <Stack spacing={0.9} sx={{ pt: 2.5, pb: 2 }}>
        <Line label="Minute no.">
          {minute.minute_id ?? <Muted>issued when this is drafted</Muted>}
        </Line>
        <Line label="Meeting">{minute.meeting_title || <Muted>—</Muted>}</Line>
        <Line label="Date">
          {minute.starts_at ? <DateText value={minute.starts_at} /> : <Muted>—</Muted>}
        </Line>
        <Line label="Time">
          {minute.starts_at ? (
            <>
              {clock(minute.starts_at)}
              {minute.ends_at ? ` — ${clock(minute.ends_at)}` : ""}
            </>
          ) : (
            <Muted>—</Muted>
          )}
        </Line>
        <Line label="Duration">{duration ?? <Muted>—</Muted>}</Line>
        <Line label="Location">{minute.location || <Muted>not recorded</Muted>}</Line>
      </Stack>

      <Divider sx={{ borderColor: alpha("#16181d", 0.18) }} />

      {/* ── The body ────────────────────────────────────────────────── */}
      <Box
        sx={{
          pt: 2.5,
          minHeight: body ? 420 : 200,
          fontSize: ".95rem",
          lineHeight: 1.75,
          "& p": { margin: "0 0 .85em" },
          "& h3": {
            fontSize: ".82rem",
            fontWeight: 700,
            letterSpacing: ".12em",
            textTransform: "uppercase",
            color: "#3b414f",
            margin: "1.4em 0 .5em",
          },
          "& ul, & ol": { margin: "0 0 .85em", paddingLeft: "1.4em" },
          // The marker the builder leaves where the consent register goes.
          // Hidden, because the table itself is drawn below.
          "& [data-minutes-consent-table]": { display: "none" },
        }}
      >
        {body ?? (minute.content ? <RichText html={minute.content} /> : <Muted>Nothing written yet.</Muted>)}
      </Box>

      {/* ── The register that closes it ─────────────────────────────── */}
      <ConsentRegister decisions={decisions} />
    </PaperSheet>
  );
}

/**
 * Name · consent · dissent · signature · reason, per decision.
 *
 * **Drawn here rather than built into the content** because it needs the
 * signature images, and an image is a file rather than text — the body is
 * sanitised HTML and could not carry one. It is also live: somebody consenting
 * after the minute was drafted appears here without the minute being rewritten.
 */
function ConsentRegister({ decisions }: { decisions: MeetingDecision[] }) {
  const withPositions = decisions.filter((d) => d.positions.length > 0);
  if (withPositions.length === 0) return null;

  return (
    <Box sx={{ pt: 3 }}>
      <Typography
        sx={{
          fontFamily: "inherit",
          fontSize: ".82rem",
          fontWeight: 700,
          letterSpacing: ".12em",
          textTransform: "uppercase",
          color: "#3b414f",
          pb: 1,
        }}
      >
        Consent and dissent
      </Typography>

      {withPositions.map((decision, index) => (
        <Box key={decision.id} sx={{ mb: 2.5 }}>
          <Typography sx={{ fontFamily: "inherit", fontSize: ".9rem", mb: 0.75 }}>
            <strong>{index + 1}.</strong> {decision.text}
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
                <Box component="th" sx={{ width: "28%" }}>Name</Box>
                <Box component="th" sx={{ width: "14%" }}>Consent</Box>
                <Box component="th" sx={{ width: "14%" }}>Dissent</Box>
                <Box component="th" sx={{ width: "20%" }}>Signature</Box>
                <Box component="th">Reason, if dissenting</Box>
              </Box>
            </Box>
            <Box component="tbody">
              {decision.positions.map((row) => (
                <Box component="tr" key={row.id}>
                  <Box component="td">{withCode(row.employee_name, row.employee_code)}</Box>
                  <Box component="td" sx={{ textAlign: "center" }}>
                    {row.position === "consent" ? "✓" : ""}
                  </Box>
                  <Box component="td" sx={{ textAlign: "center" }}>
                    {row.position === "dissent" ? "✓" : ""}
                  </Box>
                  <Box component="td">
                    {row.signature_url ? (
                      <Box
                        component="img"
                        src={row.signature_url}
                        alt=""
                        sx={{ maxHeight: 28, maxWidth: "100%", objectFit: "contain" }}
                      />
                    ) : row.position === "pending" ? (
                      <Box component="span" sx={{ color: "#9aa1ae" }}>not yet answered</Box>
                    ) : (
                      ""
                    )}
                  </Box>
                  <Box component="td">{row.reason || (row.position === "abstain" ? "Abstained" : "")}</Box>
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

/** One `Label: value` line, with the labels aligned into a column — the same
 *  arrangement the memorandum uses, because it is what a typed form does. */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: "baseline" }}>
      <Typography
        sx={{
          fontFamily: "inherit",
          fontWeight: 700,
          fontSize: ".92rem",
          width: 108,
          flexShrink: 0,
        }}
      >
        {label}:
      </Typography>
      <Box
        component="span"
        sx={{ fontFamily: "inherit", fontSize: ".92rem", flex: 1, minWidth: 0 }}
      >
        {children}
      </Box>
    </Stack>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return (
    <Box component="span" sx={{ color: "#9aa1ae", fontStyle: "italic" }}>
      {children}
    </Box>
  );
}

function clock(iso: string) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** "1 hr 30 min", because that is how somebody says it. */
function formatDuration(minutes: number | null) {
  if (minutes == null || minutes < 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} hr`;
  return `${hours} hr ${rest} min`;
}
