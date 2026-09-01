"use client";

import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import BusinessIcon from "@mui/icons-material/Business";
import PlaceIcon from "@mui/icons-material/Place";
import ScheduleIcon from "@mui/icons-material/Schedule";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Container from "@mui/material/Container";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";

/**
 * The company's public job board.
 *
 * **This is the company page, not a marketing page.** It belongs to the company
 * whose workspace it is served from — `vision.localhost/careers` shows Vision's
 * roles — so it wears the company's name rather than the product's chrome. On
 * the marketing domain there is no company and therefore no board, which is
 * what the empty state below says instead of crashing.
 *
 * **Three conditions this page depends on, each of which defeats it alone:**
 *
 * 1. Every unauthenticated path on the company host redirected to the login
 *    screen, so the one page whose audience is people *without* an account was
 *    behind a login wall. Meanwhile it was left open on the marketing domain,
 *    where there is no company to fetch jobs from — public exactly where it
 *    cannot work, private exactly where it can. Fixed in `proxy.ts`.
 * 2. The response was assigned straight to state and mapped over. When the
 *    request failed, that was an object rather than an array and the page threw
 *    — "Something broke on this page" was the whole careers site.
 * 3. **"Apply Now" was wired to nothing.** The single action the page exists
 *    for did not exist; a job board that cannot receive an application is a
 *    poster. There is a public endpoint behind it now.
 */

type PublicJob = {
  id: number;
  title: string;
  department?: string | null;
  location?: string | null;
  employment_type?: string | null;
  description?: string | null;
  posted_on?: string | null;
};

type PublicCompany = { name: string; logo_url: string | null; address: string };

const JOBS_URL = "/api/proxy/recruitment/jobs/public";
const COMPANY_URL = "/api/proxy/recruitment/jobs/public-company";

export default function CareersPage() {
  const [jobs, setJobs] = useState<PublicJob[]>([]);
  const [company, setCompany] = useState<PublicCompany | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [applyingTo, setApplyingTo] = useState<PublicJob | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [jobsRes, companyRes] = await Promise.all([fetch(JOBS_URL), fetch(COMPANY_URL)]);
        if (!jobsRes.ok) throw new Error(String(jobsRes.status));
        const data = await jobsRes.json();
        if (cancelled) return;

        // Guarded, not trusted: anything other than an array — an error
        // body, a login page, a paginated envelope — reaches `.map` and takes
        // a public page down.
        setJobs(Array.isArray(data) ? data : []);
        setCompany(companyRes.ok ? await companyRes.json() : null);
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "background.default" }}>
      <Container maxWidth="md" sx={{ py: { xs: 6, md: 10 } }}>
        <Stack spacing={1.5} sx={{ mb: 6 }}>
          {company?.logo_url ? (
            <Box
              component="img"
              src={company.logo_url}
              alt=""
              sx={{ height: 44, width: "auto", alignSelf: "flex-start", mb: 1 }}
            />
          ) : null}
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: ".12em" }}>
            {company?.name ?? "Open roles"}
          </Typography>
          <Typography variant="h3" sx={{ fontWeight: 800, letterSpacing: "-.02em" }}>
            {jobs.length > 0
              ? `${jobs.length} role${jobs.length === 1 ? "" : "s"} open right now.`
              : "Open roles."}
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ maxWidth: "56ch" }}>
            {company?.address
              ? `Applications go straight to the hiring team at ${company.name}. Based in ${company.address}.`
              : "Applications go straight to the hiring team."}
          </Typography>
        </Stack>

        {state === "loading" ? (
          <Stack sx={{ alignItems: "center", py: 8 }}>
            <CircularProgress size={28} />
          </Stack>
        ) : state === "error" ? (
          <Alert severity="info" sx={{ borderRadius: 2 }}>
            {/* The marketing domain lands here: there is no company to have
                roles. Saying so is better than an error, which suggests the
                page is broken rather than in the wrong place. */}
            Open roles are listed on each company&rsquo;s own workspace address. If you were sent a
            link to a specific role, use that link.
          </Alert>
        ) : jobs.length === 0 ? (
          <Box
            sx={{
              border: "1px dashed",
              borderColor: "divider",
              borderRadius: 2,
              p: 5,
              textAlign: "center",
            }}
          >
            <Typography sx={{ fontWeight: 600, mb: 0.5 }}>Nothing open at the moment</Typography>
            <Typography variant="body2" color="text.secondary">
              There are no roles being advertised right now. It is worth checking back — postings go
              up here the moment they open.
            </Typography>
          </Box>
        ) : (
          <Stack spacing={2}>
            {jobs.map((job) => (
              <Box
                key={job.id}
                sx={{
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 2,
                  bgcolor: "background.paper",
                  p: { xs: 2.5, md: 3 },
                  transition: "border-color 160ms, box-shadow 160ms",
                  "&:hover": { borderColor: "primary.main", boxShadow: 2 },
                }}
              >
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={2}
                  sx={{ alignItems: { sm: "flex-start" }, justifyContent: "space-between" }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                      {job.title}
                    </Typography>
                    <Stack
                      direction="row"
                      spacing={2}
                      sx={{ flexWrap: "wrap", gap: 1, mt: 1, color: "text.secondary" }}
                    >
                      {job.department ? (
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                          <BusinessIcon sx={{ fontSize: 16 }} />
                          <Typography variant="body2">{job.department}</Typography>
                        </Stack>
                      ) : null}
                      {job.location ? (
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                          <PlaceIcon sx={{ fontSize: 16 }} />
                          <Typography variant="body2">{job.location}</Typography>
                        </Stack>
                      ) : null}
                      {job.employment_type ? (
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                          <ScheduleIcon sx={{ fontSize: 16 }} />
                          <Typography variant="body2">{job.employment_type}</Typography>
                        </Stack>
                      ) : null}
                    </Stack>
                  </Box>
                  <Button
                    variant="contained"
                    endIcon={<ArrowForwardIcon />}
                    onClick={() => setApplyingTo(job)}
                    sx={{ flexShrink: 0 }}
                  >
                    Apply
                  </Button>
                </Stack>

                {job.description ? (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{
                      mt: 2,
                      display: "-webkit-box",
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {job.description}
                  </Typography>
                ) : null}
              </Box>
            ))}
          </Stack>
        )}

        {company ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 8 }}>
            {company.name}
          </Typography>
        ) : null}
      </Container>

      <ApplyDialog job={applyingTo} onClose={() => setApplyingTo(null)} />
    </Box>
  );
}

/**
 * The application form.
 *
 * Four fields, and only the first two are required. Every extra question on a
 * public form costs applicants, and the ones worth asking are asked by a person
 * later — the hiring pipeline this feeds already has notes, ratings and stages
 * for exactly that.
 */
function ApplyDialog({ job, onClose }: { job: PublicJob | null; onClose: () => void }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [resume, setResume] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // A fresh form per role, so applying twice does not resubmit the first one's
  // state — and so the confirmation from the last application is not still on
  // screen when the next dialog opens.
  const [openFor, setOpenFor] = useState<number | null>(null);
  if (job && openFor !== job.id) {
    setOpenFor(job.id);
    setForm({ name: "", email: "", phone: "" });
    setResume(null);
    setError(null);
    setSent(false);
  }

  async function submit() {
    if (!job) return;
    setError(null);
    if (!form.name.trim() || !form.email.trim()) {
      setError("Your name and email are needed so we can get back to you.");
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.append("name", form.name.trim());
      body.append("email", form.email.trim());
      if (form.phone.trim()) body.append("phone", form.phone.trim());
      if (resume) body.append("resume", resume);

      // No trailing slash — Next answers 308 to the slashless path and the
      // browser replays the whole upload. See `useAssets`.
      const res = await fetch(`/api/proxy/recruitment/jobs/${job.id}/apply`, {
        method: "POST",
        body,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? "Your application could not be sent.");
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your application could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={job != null} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>
        {sent ? "Application sent" : `Apply — ${job?.title ?? ""}`}
      </DialogTitle>
      <DialogContent dividers>
        {sent ? (
          <Typography variant="body2" color="text.secondary">
            Thank you — your application is with the hiring team. If it is a fit, somebody will be
            in touch at the address you gave.
          </Typography>
        ) : (
          <Stack spacing={2}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <TextField
              label="Your name"
              fullWidth
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <TextField
              label="Email"
              type="email"
              fullWidth
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <TextField
              label="Phone"
              fullWidth
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              helperText="Optional"
            />
            <input
              ref={fileInput}
              type="file"
              hidden
              accept=".pdf,.doc,.docx"
              onChange={(e) => {
                setResume(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
            <Button
              variant="outlined"
              startIcon={<AttachFileIcon />}
              onClick={() => fileInput.current?.click()}
            >
              {resume ? resume.name : "Attach a CV (optional)"}
            </Button>
            {resume ? (
              <Chip label={`${(resume.size / 1024 / 1024).toFixed(1)} MB`} size="small" sx={{ alignSelf: "flex-start" }} />
            ) : null}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{sent ? "Close" : "Cancel"}</Button>
        {sent ? null : (
          <Button variant="contained" onClick={submit} disabled={busy}>
            {busy ? "Sending…" : "Send application"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
