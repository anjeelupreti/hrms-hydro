"use client";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { analyticsCard } from "@/lib/theme/cards";
import { CURRENCY_PREFIX, money } from "@/lib/format/money";

/**
 * Expense claims by what is owed, not by how many were filed.
 *
 * **The count is the wrong measure and the endpoint knew it.**
 * `expenses/claims/status-counts` returns a count *and* a summed amount per
 * status, and every existing caller uses only the count — for filter chips,
 * which is fair. But "seven claims pending" says nothing about whether that is
 * a lunch receipt or a fortnight of site travel. The money is the fact somebody
 * would act on.
 *
 * **A segmented bar of one total, not five separate bars.** Every claim is part
 * of the same pot; a bar chart of five statuses invites comparing them as
 * independent quantities when what matters is the *split* — how much of what
 * has been claimed is still waiting on somebody. One bar makes that a length
 * you read in a glance.
 *
 * **Cancelled is excluded from the bar and named under it.** A withdrawn claim
 * is not money in any state — leaving it in the total would inflate the
 * denominator and make the pending share look smaller than it is.
 */

const SEGMENTS = [
  { key: "pending", label: "Waiting on approval", hue: "var(--hrms-status-warning-solid)" },
  { key: "approved", label: "Approved, not yet paid", hue: "var(--hrms-module-expenses, var(--hrms-data-2))" },
  { key: "reimbursed", label: "Reimbursed", hue: "var(--hrms-status-success-solid)" },
  { key: "rejected", label: "Rejected", hue: "var(--hrms-data-5)" },
] as const;

type Bucket = { count: number; amount: string };
type Counts = { total: number } & Record<string, Bucket | number>;

function bucket(data: Counts | undefined, key: string): Bucket {
  const raw = data?.[key];
  if (raw && typeof raw === "object") return raw;
  return { count: 0, amount: "0" };
}

export default function ClaimsFlow() {
  const [active, setActive] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["expenses", "status-counts"],
    queryFn: async () => {
      const res = await fetch("/api/proxy/expenses/claims/status-counts");
      if (!res.ok) throw new Error("Could not load expense claims");
      return (await res.json()) as Counts;
    },
  });

  if (isLoading) return <Skeleton variant="rounded" height={268} />;
  if (!data) return null;

  const rows = SEGMENTS.map((segment) => {
    const b = bucket(data, segment.key);
    return { ...segment, count: b.count, amount: Number(b.amount) || 0 };
  });
  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);
  const pending = rows.find((r) => r.key === "pending");
  const cancelled = bucket(data, "cancelled");

  return (
    <Card sx={analyticsCard}>
      <CardContent>
        <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between" }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Expense claims
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {CURRENCY_PREFIX}
            {money(totalAmount)} claimed
          </Typography>
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
          {totalAmount === 0
            ? "No claims filed."
            : pending && pending.amount > 0
              ? `${CURRENCY_PREFIX}${money(pending.amount)} is waiting on an approver.`
              : "Nothing is waiting on an approver."}
        </Typography>

        {totalAmount === 0 ? null : (
          <>
            <Box
              sx={{ display: "flex", gap: "2px", height: 26, mb: 2 }}
              onMouseLeave={() => setActive(null)}
            >
              {rows.map((row) =>
                row.amount === 0 ? null : (
                  <Box
                    key={row.key}
                    onMouseEnter={() => setActive(row.key)}
                    sx={{
                      flexGrow: row.amount,
                      borderRadius: "3px",
                      bgcolor: row.hue,
                      opacity: active && active !== row.key ? 0.35 : 1,
                      transition: "opacity .18s",
                      cursor: "default",
                    }}
                  />
                ),
              )}
            </Box>

            <Stack spacing={0.75} sx={{ flexGrow: 1 }}>
              {rows.map((row) => (
                <Stack
                  key={row.key}
                  direction="row"
                  spacing={1}
                  onMouseEnter={() => setActive(row.key)}
                  onMouseLeave={() => setActive(null)}
                  sx={{
                    alignItems: "center",
                    opacity: row.amount === 0 ? 0.45 : 1,
                    px: 0.5,
                    borderRadius: 1,
                    bgcolor: active === row.key ? "action.hover" : "transparent",
                  }}
                >
                  <Box
                    sx={{ width: 9, height: 9, borderRadius: "2px", bgcolor: row.hue, flexShrink: 0 }}
                  />
                  <Typography variant="caption" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>
                    {row.label}
                  </Typography>
                  <Typography variant="caption" sx={{ color: "text.disabled", flexShrink: 0 }}>
                    {row.count}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      minWidth: 78,
                      textAlign: "right",
                    }}
                  >
                    {CURRENCY_PREFIX}
                    {money(row.amount)}
                  </Typography>
                </Stack>
              ))}
            </Stack>

            {cancelled.count > 0 ? (
              <Typography variant="caption" sx={{ color: "text.disabled", mt: 1, display: "block" }}>
                {cancelled.count} withdrawn, left out of the total.
              </Typography>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
