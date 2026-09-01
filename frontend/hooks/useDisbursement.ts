"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiErrorMessage } from "@/lib/apiError";

/**
 * Paying the run: one bank instruction per bank, and who is not in them.
 *
 * The disbursement workflow. `PaymentBatch` groups a run's payslips into one
 * instruction per bank, tracks who was *excluded* and why, renders the file in
 * each bank's own layout, emails it, and keeps **sent** and **acknowledged** as
 * separate states — collapsing them would let a payslip claim to be paid on the
 * strength of an email nobody has answered.
 *
 * The older route is `bank-file`: one flat spreadsheet of every
 * payable employee, plus `mark-all-paid`. That is the same job done without the
 * two things this system exists for — **it does not tell you who could not be
 * paid**, and it collapses handed-over into confirmed.
 */

export type BatchStatus = "draft" | "sent" | "acknowledged" | "failed";

export type PaymentBatchItem = {
  id: number;
  employee_code: string;
  account_name: string;
  account_number: string;
  account_type: string;
  branch: string;
  amount: string;
};

export type PaymentBatch = {
  id: number;
  payroll_run: number;
  bank_name: string;
  status: BatchStatus;
  total_amount: string;
  payslip_count: number;
  sent_at: string | null;
  acknowledged_at: string | null;
  bank_reference: string;
  failure_reason: string;
  items: PaymentBatchItem[];
};

export type PaymentExclusion = {
  id: number;
  payslip: number;
  employee_code: string;
  employee_name: string;
  reason: string;
  created_at: string;
};

export type BankFormat = { key: string; label: string };

export type PaymentsPayload = {
  batches: PaymentBatch[];
  excluded: PaymentExclusion[];
  formats: BankFormat[];
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(apiErrorMessage(data, res.status));
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

const RUNS = "/api/proxy/payroll/runs";
const BATCHES = "/api/proxy/payroll/payment-batches";

export function useRunPayments(runId: number | null) {
  return useQuery({
    queryKey: ["payroll", "payments", runId],
    queryFn: () => fetchJson<PaymentsPayload>(`${RUNS}/${runId}/payments`),
    enabled: runId != null,
  });
}

/** Every write refreshes the run's payments *and* its payslips: acknowledging a
 *  batch is what lets a payslip say paid, so a stale payslip list would
 *  contradict the batch on the same screen. */
function usePaymentMutation<TArgs>(runId: number | null, fn: (args: TArgs) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["payroll", "payments", runId] });
      client.invalidateQueries({ queryKey: ["payroll", "run", runId] });
      client.invalidateQueries({ queryKey: ["payroll", "payslips", runId] });
    },
  });
}

export function useBuildPayments(runId: number | null) {
  return usePaymentMutation(runId, () =>
    fetchJson<PaymentsPayload>(`${RUNS}/${runId}/build-payments`, { method: "POST" }),
  );
}

export function useMarkBatchSent(runId: number | null) {
  return usePaymentMutation(runId, (batchId: number) =>
    fetchJson<PaymentBatch>(`${BATCHES}/${batchId}/mark-sent`, { method: "POST" }),
  );
}

export function useAcknowledgeBatch(runId: number | null) {
  return usePaymentMutation(runId, ({ batchId, reference }: { batchId: number; reference: string }) =>
    fetchJson<PaymentBatch>(`${BATCHES}/${batchId}/acknowledge`, {
      method: "POST",
      body: JSON.stringify({ bank_reference: reference }),
    }),
  );
}

export function useEmailBatch(runId: number | null) {
  return usePaymentMutation(
    runId,
    ({
      batchId,
      recipients,
      format,
      message,
    }: {
      batchId: number;
      recipients: string;
      format: string;
      message?: string;
    }) =>
      fetchJson<PaymentBatch>(`${BATCHES}/${batchId}/send-email`, {
        method: "POST",
        body: JSON.stringify({ recipients, format, message: message ?? "" }),
      }),
  );
}

/**
 * The download is a plain link, not a fetch — the browser saves the file and
 * the endpoint deliberately does *not* mark the batch sent, so generating one
 * to check it does not lie about the money having gone.
 *
 * **`layout`, not `format`.** DRF's `URL_FORMAT_OVERRIDE` is `"format"`, so
 * that parameter selects a *renderer* — `?format=nabil` fails content
 * negotiation and 404s before the view runs.
 */
export function batchDownloadUrl(batchId: number, layout: string) {
  return `${BATCHES}/${batchId}/download?layout=${encodeURIComponent(layout)}`;
}
