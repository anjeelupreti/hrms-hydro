"use client";

import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DownloadIcon from "@mui/icons-material/Download";
import PrintIcon from "@mui/icons-material/Print";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import NextLink from "next/link";
import { useParams } from "next/navigation";

import DateText from "@/components/common/DateText";
import PageContainer from "@/components/shell/PageContainer";
import { useEnrollment } from "@/hooks/useTraining";

/**
 * A completion certificate, built to be printed.
 *
 * **Its colours are literals on purpose, and that is the one screen where they
 * should be.** Everything else in the product takes its palette from the theme
 * so it follows the company's accent and the reader's colour scheme; a
 * certificate is a document. It has to come off the printer the same way for
 * everyone, and a dark-scheme reader must not get a dark certificate.
 *
 * Recorded here because a consistency sweep will otherwise flag this file every
 * time it runs.
 */
export default function CertificatePage() {
  const params = useParams<{ enrollmentId: string }>();
  const id = Number(params.enrollmentId);
  const { data: enr, isLoading } = useEnrollment(Number.isNaN(id) ? null : id);

  if (isLoading) {
    return (
      <PageContainer>
        <Skeleton variant="rounded" height={420} />
      </PageContainer>
    );
  }

  if (!enr) {
    return (
      <PageContainer>
        <Alert severity="error">Certificate not found.</Alert>
      </PageContainer>
    );
  }

  if (!enr.certificate_issued_at) {
    return (
      <PageContainer>
        <Button component={NextLink} href="/training" startIcon={<ArrowBackIcon />} size="small" sx={{ mb: 2 }}>
          Training
        </Button>
        <Alert severity="info">
          No certificate has been issued for this training yet. Once HR issues it, it will appear here.
        </Alert>
      </PageContainer>
    );
  }

  const start = enr.session_start ? new Date(enr.session_start) : null;
  const end = enr.session_end ? new Date(enr.session_end) : null;
  const durationHours =
    start && end ? Math.max(0, Math.round(((end.getTime() - start.getTime()) / 3_600_000) * 10) / 10) : 0;

  return (
    <PageContainer>
      <Stack direction="row" spacing={1} className="no-print" sx={{ mb: 2, alignItems: "center" }}>
        <Button component={NextLink} href="/training" startIcon={<ArrowBackIcon />} size="small">
          Training
        </Button>
        <Box sx={{ flex: 1 }} />
        {enr.has_certificate && (
          <Button
            startIcon={<DownloadIcon />}
            component={Link}
            href={`/api/proxy/training/enrollments/${enr.id}/certificate`}
            target="_blank"
            rel="noopener"
          >
            Download PDF
          </Button>
        )}
        <Button variant="contained" startIcon={<PrintIcon />} onClick={() => window.print()}>
          Print / Save as PDF
        </Button>
      </Stack>

      {/* The certificate itself — a self-contained sheet that prints cleanly. */}
      <Box
        sx={{
          maxWidth: 900,
          mx: "auto",
          aspectRatio: { xs: "auto", sm: "1.414 / 1" },
          p: { xs: 3, sm: 6 },
          borderRadius: 3,
          textAlign: "center",
          position: "relative",
          color: "#1e293b",
          bgcolor: "#ffffff",
          border: "3px solid #4f46e5",
          boxShadow: "0 10px 40px rgba(15,23,42,0.12)",
          fontFamily: "Georgia, 'Times New Roman', serif",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          "&::after": {
            content: '""',
            position: "absolute",
            inset: 10,
            border: "1px solid #c7d2fe",
            borderRadius: 2,
            pointerEvents: "none",
          },
        }}
      >
        <Typography sx={{ color: "#4f46e5", letterSpacing: 3, fontWeight: 700, textTransform: "uppercase", fontSize: 14 }}>
          HRMS · Learning &amp; Development
        </Typography>
        <Typography sx={{ fontSize: { xs: 30, sm: 42 }, fontWeight: 700, color: "#0f172a", mt: 2 }}>
          Certificate of Completion
        </Typography>
        <Typography sx={{ color: "#64748b", letterSpacing: 1, mt: 0.5 }}>This is proudly presented to</Typography>

        <Typography sx={{ fontSize: { xs: 26, sm: 34 }, color: "#4f46e5", fontStyle: "italic", mt: 3 }}>
          {enr.employee_name}
        </Typography>
        <Box sx={{ width: "55%", mx: "auto", borderBottom: "1px solid #cbd5e1", mb: 3 }} />

        <Typography sx={{ fontSize: { xs: 15, sm: 16 }, color: "#334155", lineHeight: 1.8, maxWidth: 640, mx: "auto" }}>
          for successfully completing the training program{" "}
          <Box component="span" sx={{ fontWeight: 700, color: "#0f172a" }}>
            “{enr.program_title}”
          </Box>
          {durationHours ? `, comprising ${durationHours} hour${durationHours === 1 ? "" : "s"} of instruction` : ""}
          {enr.score != null ? `, with an assessment score of ${enr.score}` : ""}.
        </Typography>

        <Typography sx={{ color: "#64748b", fontSize: 13, mt: 4 }}>
          Completed on <DateText value={enr.completed_at ?? enr.session_end} /> · Employee ID {enr.employee_code}
        </Typography>

        <Stack direction="row" sx={{ justifyContent: "space-between", mt: { xs: 4, sm: 8 }, px: { sm: 4 } }}>
          <Box sx={{ width: "40%" }}>
            <Box sx={{ borderTop: "1px solid #94a3b8", pt: 0.5, fontSize: 12, color: "#475569" }}>
              Trainer{enr.trainer_name ? ` — ${enr.trainer_name}` : ""}
            </Box>
          </Box>
          <Box sx={{ width: "40%" }}>
            <Box sx={{ borderTop: "1px solid #94a3b8", pt: 0.5, fontSize: 12, color: "#475569" }}>Human Resources</Box>
          </Box>
        </Stack>
      </Box>
    </PageContainer>
  );
}
