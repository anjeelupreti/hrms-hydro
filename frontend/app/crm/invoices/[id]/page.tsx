"use client";

import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PrintIcon from "@mui/icons-material/Print";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import NextLink from "next/link";
import { useParams } from "next/navigation";

import DateText from "@/components/common/DateText";
import Breadcrumbs from "@/components/shell/Breadcrumbs";
import { money } from "@/lib/format/money";
import PageContainer from "@/components/shell/PageContainer";
import { useInvoice } from "@/hooks/useCrm";
import type { InvoiceStatus } from "@/types/crm";

const STATUS_COLOR: Record<InvoiceStatus, "default" | "info" | "success" | "error"> = {
  draft: "default",
  sent: "info",
  paid: "success",
  void: "error",
};

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { data: inv, isLoading } = useInvoice(Number.isNaN(id) ? null : id);

  if (isLoading || !inv) {
    return (
      <PageContainer>
        <Skeleton variant="rounded" height={400} />
      </PageContainer>
    );
  }

  // An invoice carries its own currency — a client may be billed in USD while
  // payroll is in rupees — so the symbol comes from the record rather than from
  // the shared prefix. The digits are shared, so the same figure is written the
  // same way here as on a payslip.
  const withCurrency = (n: string | number) => `${inv.currency} ${money(n)}`;

  return (
    <PageContainer>
      <Breadcrumbs />
      <Stack direction="row" spacing={1} className="no-print" sx={{ mb: 2, alignItems: "center" }}>
        <Button component={NextLink} href="/crm/invoices" startIcon={<ArrowBackIcon />} size="small">
          Invoices
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" startIcon={<PrintIcon />} onClick={() => window.print()}>
          Print / Save as PDF
        </Button>
      </Stack>

      <Box
        sx={{
          maxWidth: 800,
          mx: "auto",
          p: { xs: 3, sm: 5 },
          bgcolor: "background.paper",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 2,
        }}
      >
        <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start", mb: 4 }}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 800, color: "primary.main" }}>
              INVOICE
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {inv.number}
            </Typography>
          </Box>
          <Chip label={inv.status} color={STATUS_COLOR[inv.status]} />
        </Stack>

        <Stack direction="row" sx={{ justifyContent: "space-between", mb: 3, flexWrap: "wrap", gap: 2 }}>
          <Box>
            <Typography variant="overline" color="text.secondary">
              Bill to
            </Typography>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {inv.client_name}
            </Typography>
          </Box>
          <Box sx={{ textAlign: { sm: "right" } }}>
            <Typography variant="body2" color="text.secondary">
              Issued: <DateText value={inv.issue_date} />
            </Typography>
            {inv.due_date && (
              <Typography variant="body2" color="text.secondary">
                Due: <DateText value={inv.due_date} />
              </Typography>
            )}
          </Box>
        </Stack>

        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>Description</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>Qty</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>Unit price</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>Amount</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {inv.line_items.map((li, i) => (
              <TableRow key={i}>
                <TableCell>{li.description}</TableCell>
                <TableCell align="right">{Number(li.quantity).toLocaleString()}</TableCell>
                <TableCell align="right">{withCurrency(li.unit_price)}</TableCell>
                <TableCell align="right">{withCurrency(li.amount ?? Number(li.quantity) * Number(li.unit_price))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Divider sx={{ my: 2 }} />
        <Stack sx={{ alignItems: "flex-end" }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            Total: {withCurrency(inv.total)}
          </Typography>
        </Stack>

        {inv.notes && (
          <Box sx={{ mt: 3 }}>
            <Typography variant="overline" color="text.secondary">
              Notes
            </Typography>
            <Typography variant="body2">{inv.notes}</Typography>
          </Box>
        )}
      </Box>
    </PageContainer>
  );
}
