"use client";

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Container from "@mui/material/Container";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * The page a candidate lands on from their offer email.
 *
 * Where the candidate answers an offer themselves. `accept_offer` reachable
 * only by an authenticated HR user records "accepted" on the strength of
 * somebody in the office clicking a button after a phone call, and being hired
 * is mutual.
 *
 * **The company page with no login.** Served from the company's own host, like
 * `/careers`, and reachable by a secret in the URL rather than an account — an
 * offer you must register to accept is an offer with a form in front of it.
 *
 * **It wears the company's name, not the product's.** The candidate is
 * answering *SignCo*, and has no reason to know or care what the HR software is
 * called. Same reasoning as the careers board.
 *
 * **Declining is as easy as accepting, and the reason is optional.** A decline
 * held up by a mandatory form becomes an unanswered offer, and then the reason
 * is lost as well as the answer. It is asked for once, plainly, and skipping it
 * still declines.
 */

type Offer = {
  candidate_name: string;
  company_name: string;
  role: string;
  department: string;
  annual_salary: string | null;
  start_date: string | null;
  expires_on: string | null;
  status: string;
  can_respond: boolean;
  responded_at: string | null;
};

type State =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "ready"; offer: Offer }
  | { kind: "error"; detail: string };

function money(value: string | null) {
  if (value === null) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  // Lakh grouping, like every other figure in the product.
  return `Rs ${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function longDate(iso: string | null) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={{ xs: 0.25, sm: 2 }}
      sx={{ py: 1.25, justifyContent: "space-between", alignItems: { sm: "baseline" } }}
    >
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography sx={{ fontWeight: 650, textAlign: { sm: "right" } }}>{value}</Typography>
    </Stack>
  );
}

export default function OfferPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const [state, setState] = useState<State>({ kind: "loading" });
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/proxy/recruitment/offer-response/${token}`);
        if (res.status === 404) {
          if (!cancelled) setState({ kind: "missing" });
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const offer = (await res.json()) as Offer;
        if (!cancelled) setState({ kind: "ready", offer });
      } catch {
        if (!cancelled) {
          setState({
            kind: "error",
            detail: "We could not load this offer. Please try again in a moment.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function respond(action: "accept" | "decline") {
    setBusy(true);
    setFailed(null);
    try {
      const res = await fetch(`/api/proxy/recruitment/offer-response/${token}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: action === "decline" ? reason : "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The server's wording, not a house message — it explains *why* (expired,
        // already answered), and a generic "something went wrong" would throw
        // that away.
        setFailed(data.detail ?? "That did not go through. Please try again.");
        return;
      }
      setState({ kind: "ready", offer: data as Offer });
      setDeclining(false);
    } catch {
      setFailed("We could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const shell = (children: React.ReactNode) => (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", py: { xs: 4, md: 10 } }}>
      <Container maxWidth="sm">{children}</Container>
    </Box>
  );

  if (state.kind === "loading") {
    return shell(
      <Stack sx={{ alignItems: "center", py: 8 }}>
        <CircularProgress />
      </Stack>,
    );
  }

  if (state.kind === "missing") {
    return shell(
      <Paper variant="outlined" sx={{ p: { xs: 3, md: 5 }, borderRadius: 3, textAlign: "center" }}>
        <ErrorOutlineIcon sx={{ fontSize: 44, color: "text.disabled", mb: 1.5 }} />
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
          This link is not valid
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {/* Deliberately says nothing about whether an offer exists. The
              endpoint answers 404 for an unknown token precisely so that
              guessing gets no feedback, and the page must not undo that. */}
          It may have been mistyped, or it may have been replaced by a newer one.
          Please check the link in your email, or contact the company directly.
        </Typography>
      </Paper>,
    );
  }

  if (state.kind === "error") {
    return shell(
      <Alert severity="error">{state.detail}</Alert>,
    );
  }

  const { offer } = state;
  const answered = !offer.can_respond;
  const accepted = offer.status === "accepted";

  return (
    <>
      {shell(
        <Stack spacing={3}>
          <Box sx={{ textAlign: "center" }}>
            {offer.company_name ? (
              <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: ".14em" }}>
                {offer.company_name}
              </Typography>
            ) : null}
            <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: "-.02em", mt: 0.5 }}>
              {answered ? "Your response is recorded" : "We would like you to join us"}
            </Typography>
          </Box>

          <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 4 }, borderRadius: 3 }}>
            <Typography sx={{ fontSize: "1.05rem", mb: 2 }}>
              Hello <strong>{offer.candidate_name}</strong>,
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              These are the terms as recorded. If anything looks wrong, contact the company
              before answering rather than accepting and correcting it later.
            </Typography>

            <Divider />
            <Fact label="Role" value={offer.role || null} />
            <Divider />
            <Fact label="Department" value={offer.department || null} />
            <Divider />
            <Fact label="Annual salary" value={money(offer.annual_salary)} />
            <Divider />
            <Fact label="Start date" value={longDate(offer.start_date)} />
            <Divider />
            <Fact label="Please reply by" value={longDate(offer.expires_on)} />
            <Divider />

            {answered ? (
              <Alert
                severity={accepted ? "success" : "info"}
                icon={accepted ? <CheckCircleIcon /> : undefined}
                sx={{ mt: 3 }}
              >
                {accepted
                  ? "You have accepted this offer. The company will be in touch about your first day."
                  : offer.status === "declined"
                    ? "You have declined this offer. Thank you for letting us know."
                    : `This offer is ${offer.status} and can no longer be answered.`}
              </Alert>
            ) : (
              <>
                {failed ? (
                  <Alert severity="error" sx={{ mt: 3 }}>
                    {failed}
                  </Alert>
                ) : null}
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mt: 3 }}>
                  <Button
                    variant="contained"
                    size="large"
                    fullWidth
                    disabled={busy}
                    onClick={() => respond("accept")}
                  >
                    Accept the offer
                  </Button>
                  {/* Same size and same reach as accepting. A decline hidden
                      behind a small link is how somebody stops answering at
                      all, and an unanswered offer teaches recruitment nothing —
                      it loses the answer *and* the reason. */}
                  <Button
                    size="large"
                    fullWidth
                    disabled={busy}
                    onClick={() => setDeclining(true)}
                    sx={{ borderColor: "divider", border: "1px solid" }}
                  >
                    Decline
                  </Button>
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
                  This link is personal to you. Anyone who opens it can answer on your behalf,
                  so please do not forward it.
                </Typography>
              </>
            )}
          </Paper>
        </Stack>,
      )}

      <Dialog open={declining} onClose={() => (busy ? null : setDeclining(false))} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Decline this offer?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            If you are willing to say why, it genuinely helps — but you do not have to.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={2}
            label="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 255))}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeclining(false)} disabled={busy}>
            Go back
          </Button>
          <Button variant="contained" color="error" onClick={() => respond("decline")} disabled={busy}>
            Decline
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
