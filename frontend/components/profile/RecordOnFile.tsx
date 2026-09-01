"use client";

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import Amount from "@/components/common/Amount";
import { useState } from "react";

import RequestChangeDialog from "@/components/profile/RequestChangeDialog";
import type { MyProfile } from "@/hooks/useProfile";

/**
 * What the company holds about you, so you can check it is right.
 *
 * Every bank field, every statutory number, the citizenship details and the
 * legal name — the fields somebody most needs to check are right about
 * themselves, because a wrong account number is a salary paid to a stranger and
 * a missing SSF number is a return that will not file.
 *
 * **Blank is a finding, not a gap to hide.** An empty PAN is *why* something
 * downstream is not working, so a missing value is shown as missing and marked,
 * rather than omitted or rendered as an apologetic dash. The counts at the top
 * of each group say how much is outstanding without making anybody read every
 * row.
 *
 * **Read-only, next to a way to ask.** These are not un-editable; they go
 * through `EmployeeChangeRequest`, because a bank account changed quietly the
 * day before payroll is the exact loss that flow exists to prevent. Seeing the
 * value and requesting a correction are two different actions and this screen
 * only does the first.
 *
 * **The account number is masked even from its owner.** The full number is only
 * needed to *build a payment file*, which is a server-side job; the last four
 * answer the only question somebody asks of their own account — is this the
 * right one.
 */

type Row = {
  label: string;
  value: string | null;
  /** The model field this row shows. Present means it can be requested. */
  field?: string;
  /** Why this one matters when it is blank. Shown on the marker. */
  needed?: string;
  /**
   * Who puts this one on file, for rows that cannot be requested.
   *
   * A row with no pencil says *not on file* and stops, which leaves the reader
   * unable to tell whether the field is waiting on them or on somebody else.
   *
   * A file cannot travel through `EmployeeChangeRequest` — that flow shows an
   * approver an old value beside a new one — so the citizenship scans will
   * never grow a pencil, and naming who holds them is the whole remedy.
   */
  held?: string;
  /** Render through `Amount` so the masking control applies. */
  sensitive?: boolean;
};

function Group({
  title,
  note,
  rows,
  onRequest,
}: {
  title: string;
  note?: string;
  rows: Row[];
  onRequest: (row: Row) => void;
}) {
  const missing = rows.filter((r) => !r.value).length;

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mb: note ? 0.25 : 1.5 }}>
          <Typography variant="overline" color="text.secondary">
            {title}
          </Typography>
          {missing > 0 && (
            <Typography variant="caption" sx={{ color: "warning.main", fontWeight: 600, ml: "auto" }}>
              {missing} not on file
            </Typography>
          )}
        </Box>
        {note && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
            {note}
          </Typography>
        )}

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "minmax(9rem, max-content) 1fr" },
            columnGap: 2,
            rowGap: 1.25,
            alignItems: "baseline",
          }}
        >
          {rows.map((row) => (
            <Box key={row.label} sx={{ display: "contents" }}>
              <Typography variant="body2" color="text.secondary">
                {row.label}
              </Typography>
              {row.value ? (
                <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 500, wordBreak: "break-word" }}>
                    {row.sensitive ? <Amount personal value={row.value} /> : row.value}
                  </Typography>
                  {/* The affordance sits on the row it changes. A panel at the
                      foot of the page means scrolling past the value, finding
                      the field again by name in a list of twenty, and retyping
                      it. */}
                  {row.field ? (
                    <Tooltip title={`Ask for ${row.label.toLowerCase()} to be changed`}>
                      <IconButton
                        size="small"
                        onClick={() => onRequest(row)}
                        aria-label={`Ask for ${row.label} to be changed`}
                        sx={{ opacity: 0.45, "&:hover": { opacity: 1 } }}
                      >
                        <EditOutlinedIcon sx={{ fontSize: 15 }} />
                      </IconButton>
                    </Tooltip>
                  ) : null}
                </Stack>
              ) : (
                <Tooltip title={row.needed ?? "Nothing recorded yet."}>
                  <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                    <ErrorOutlineIcon sx={{ fontSize: 15, color: "warning.main" }} />
                    <Typography variant="body2" sx={{ color: "text.disabled", fontStyle: "italic" }}>
                      not on file
                    </Typography>
                    {row.field ? (
                      <IconButton
                        size="small"
                        onClick={() => onRequest(row)}
                        aria-label={`Ask for ${row.label} to be added`}
                        sx={{ opacity: 0.45, "&:hover": { opacity: 1 } }}
                      >
                        <EditOutlinedIcon sx={{ fontSize: 15 }} />
                      </IconButton>
                    ) : row.held ? (
                      // Inline rather than in the tooltip above: somebody who
                      // does not know a row is actionable has no reason to
                      // hover it, so a tooltip is the one place this answer
                      // cannot be.
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 0.25 }}>
                        · {row.held}
                      </Typography>
                    ) : null}
                  </Box>
                </Tooltip>
              )}
            </Box>
          ))}
        </Box>
      </CardContent>
    </Card>
  );
}

function onFile(present: boolean, label: string) {
  return present ? `${label} — on file` : null;
}

export default function RecordOnFile({ profile }: { profile: MyProfile }) {
  // Which row is being asked about, or null. One dialog rather than one per
  // row: twenty mounted dialogs to show at most one is twenty subscriptions to
  // the requestable-fields query.
  const [asking, setAsking] = useState<Row | null>(null);
  const legalName = [profile.legal_first_name, profile.legal_middle_name, profile.legal_last_name]
    .filter(Boolean)
    .join(" ");

  return (
    <Box>
      {/* Read-only with no explanation reads as broken — somebody who finds
          fields they cannot change will ask who can, and the page has to
          answer.

          Placed above the fields rather than below: after scrolling past six
          greyed-out values somebody has already concluded the page is broken. */}
      <Alert severity="info" icon={<LockOutlinedIcon fontSize="small" />} sx={{ mb: 2 }}>
        <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.25 }}>
          These are read-only on purpose — for everyone, including owners.
        </Typography>
        <Typography variant="body2">
          A bank account changed quietly the day before payroll sends somebody&rsquo;s
          salary elsewhere, and nothing about the run looks wrong. So these fields are
          <strong> requested and approved by a second person</strong> rather than edited.
          Use <strong>Ask for a change</strong> below. HR can also amend them directly on
          your employee record.
        </Typography>
      </Alert>

      <Group
        onRequest={setAsking}
        title="Paid to"
        note="Where your salary is sent. Check it against your passbook — this is the one field where a mistake means the money reaches somebody else."
        rows={[
          { field: "bank_name", label: "Bank", value: profile.bank_name || null, needed: "Payroll cannot send your salary without a bank." },
          { field: "bank_branch", label: "Branch", value: profile.bank_branch || null },
          { field: "bank_account_name", label: "Account name", value: profile.bank_account_name || null, needed: "Banks reject a transfer whose name does not match." },
          { field: "bank_account_number", label: "Account number", value: profile.bank_account_number || null, sensitive: true, needed: "Payroll cannot send your salary without an account number." },
          { field: "bank_account_type", label: "Account type", value: profile.bank_account_type || null },
        ]}
      />

      <Group
        onRequest={setAsking}
        title="Filed against"
        note="The numbers your employer files with under your name. A blank one is usually why a contribution or a return has not gone in."
        rows={[
          { field: "pan_number", label: "PAN", value: profile.pan_number || null, needed: "Tax is filed against your PAN." },
          { field: "ssf_number", label: "SSF", value: profile.ssf_number || null, needed: "Social security contributions cannot be filed without this." },
          { field: "pf_number", label: "Provident fund", value: profile.pf_number || null },
          { field: "cit_number", label: "CIT", value: profile.cit_number || null },
          { label: "Tax election", value: profile.tax_election || null },
        ]}
      />

      <Group
        onRequest={setAsking}
        title="Who you are, legally"
        note="The name and documents on your citizenship certificate, which payroll and every statutory filing has to match."
        rows={[
          // No single `field`: the legal name is three columns, and a request
          // naming one of them would go through with the other two unchanged.
          { label: "Legal name", value: legalName || null, needed: "Filings use your legal name, not your display name.", held: "ask HR, it is three separate fields" },
          { field: "citizenship_number", label: "Citizenship no.", value: profile.citizenship_number || null },
          { label: "Citizenship scan", value: onFile(profile.citizenship_front_on_file, "Front"), needed: "The certificate your legal name and citizenship number are read off.", held: "HR uploads this from your certificate" },
          { label: "Reverse scan", value: onFile(profile.citizenship_back_on_file, "Back"), held: "HR uploads this from your certificate" },
          // All three are in `REQUESTABLE_FIELDS`, so all three carry a
          // pencil: without it an expired passport is a field you can see is
          // wrong and cannot report.
          { field: "passport_number", label: "Passport", value: profile.passport_number || null },
          { field: "passport_expiry", label: "Passport expiry", value: profile.passport_expiry },
          { field: "marital_status", label: "Marital status", value: profile.marital_status || null, needed: "The married tax band is wider — payroll reads this." },
        ]}
      />

      <Group
        onRequest={setAsking}
        title="Your employment"
        rows={[
          { label: "Employee code", value: profile.employee_code || null },
          { label: "Department", value: profile.department_name },
          { label: "Job title", value: profile.designation_title },
          { label: "Reports to", value: profile.manager_name },
          { label: "Joined", value: profile.date_joined },
          { label: "Probation ends", value: profile.probation_end_date },
        ]}
      />

      <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start", px: 0.5 }}>
        <CheckCircleIcon sx={{ fontSize: 16, color: "text.disabled", mt: 0.25 }} />
        <Typography variant="caption" color="text.secondary" sx={{ maxWidth: "62ch" }}>
          Something wrong? Use the pencil beside any value. These are changed by request
          rather than edited directly — a bank account or a statutory number that moves
          without anybody noticing is how a salary reaches the wrong place.
        </Typography>
      </Box>

      {asking ? (
        <RequestChangeDialog
          field={asking.field as string}
          label={asking.label}
          currentValue={asking.value}
          onClose={() => setAsking(null)}
        />
      ) : null}
    </Box>
  );
}
