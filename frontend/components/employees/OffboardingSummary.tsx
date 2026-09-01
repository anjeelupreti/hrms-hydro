"use client";

/**
 * What is still open between somebody and the company on the way out.
 *
 * **Deliberately not a settlement figure.** Payroll owns money, and a second
 * place that adds up a last payment is a second answer to a question that must
 * have exactly one — the server refuses to return a net figure and a test pins
 * that. So this lists what is outstanding and stops; the final payslip is
 * computed where every other payslip is.
 *
 * **Both directions.** Assets and loans are what they owe the company; approved
 * unpaid expenses are what the company owes *them*, which is the half everybody
 * forgets until somebody chases it a month later.
 *
 * **Assembled live, never snapshotted.** A statement taken at resignation goes
 * stale the moment a laptop comes back, and a stale exit statement is worse than
 * none because it gets acted on.
 */

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DevicesIcon from "@mui/icons-material/Devices";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import PaymentsIcon from "@mui/icons-material/Payments";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

import Amount from "@/components/common/Amount";
import { useOffboardingSummary } from "@/hooks/useEmployees";
import { money } from "@/lib/format/money";


function Section({
  icon,
  title,
  hint,
  children,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <Box>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", mb: 0.5 }}>
        <Box sx={{ color: "text.disabled", display: "flex" }}>{icon}</Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
      </Stack>
      {hint ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
          {hint}
        </Typography>
      ) : null}
      {children}
    </Box>
  );
}

export default function OffboardingSummary({ employeeId }: { employeeId: number }) {
  const { data, isLoading } = useOffboardingSummary(employeeId);

  if (isLoading) return <CircularProgress size={22} />;
  if (!data) return null;

  return (
    <Stack spacing={2.5}>
      {data.is_clear ? (
        <Alert severity="success" icon={<CheckCircleIcon />}>
          Nothing outstanding. Everything issued has come back and nothing is owed
          either way.
        </Alert>
      ) : (
        <Alert severity="warning">
          Still open — worth settling before the last working day.
        </Alert>
      )}

      {/* Said once, prominently, because the obvious thing to expect from a
          screen like this is a final figure, and its absence is a decision
          rather than an omission. */}
      <Typography variant="caption" color="text.secondary">
        This is not a final settlement. What somebody is paid on the way out is
        computed by payroll, so that there is only ever one answer to it.
      </Typography>

      {data.assets_out.length > 0 ? (
        <Section
          icon={<DevicesIcon fontSize="small" />}
          title="Still holding"
          hint="Company property issued to them and not yet returned."
        >
          <Stack spacing={0.5}>
            {data.assets_out.map((asset) => (
              <Stack key={asset.id} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography variant="body2">{asset.name}</Typography>
                <Chip size="small" variant="outlined" label={asset.asset_tag} />
              </Stack>
            ))}
          </Stack>
        </Section>
      ) : null}

      {data.loans_outstanding.length > 0 ? (
        <Section
          icon={<PaymentsIcon fontSize="small" />}
          title={`Owes the company — ${money(data.loan_total)}`}
          hint="Loans and advances not yet repaid."
        >
          <Stack spacing={0.5}>
            {data.loans_outstanding.map((loan) => (
              <Stack
                key={loan.id}
                direction="row"
                sx={{ justifyContent: "space-between", gap: 1 }}
              >
                <Typography variant="body2">{loan.loan_type}</Typography>
                <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
                  <Amount personal value={loan.outstanding_balance} />
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Section>
      ) : null}

      {data.unpaid_expenses.length > 0 ? (
        <Section
          icon={<ReceiptLongIcon fontSize="small" />}
          title={`Company owes them — ${money(data.expense_total)}`}
          hint="Approved expense claims not yet reimbursed. The direction people forget."
        >
          <Stack spacing={0.5}>
            {data.unpaid_expenses.map((claim) => (
              <Stack
                key={claim.id}
                direction="row"
                sx={{ justifyContent: "space-between", gap: 1 }}
              >
                <Typography variant="body2">{claim.title}</Typography>
                <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
                  <Amount personal value={claim.amount} />
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Section>
      ) : null}

      {data.leave_remaining.length > 0 ? (
        <Section
          icon={<EventBusyIcon fontSize="small" />}
          title="Leave not taken"
          hint="Whether any of this is paid out is a policy question, not a figure this screen decides."
        >
          <Stack spacing={0.5}>
            {data.leave_remaining.map((row) => (
              <Stack
                key={row.leave_type}
                direction="row"
                sx={{ justifyContent: "space-between", gap: 1 }}
              >
                <Typography variant="body2">{row.leave_type}</Typography>
                <Typography variant="body2">{row.remaining} days</Typography>
              </Stack>
            ))}
          </Stack>
        </Section>
      ) : null}
    </Stack>
  );
}
