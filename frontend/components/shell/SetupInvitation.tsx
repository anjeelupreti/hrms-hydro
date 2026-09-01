"use client";

/**
 * "You are not set up yet", where somebody will actually see it.
 *
 * **The setup page only helps the company who knows to go there.** A new workspace
 * lands on the dashboard, and the failure this exists to prevent is a company
 * discovering at the end of the month that payroll could never have run — so
 * the prompt has to come to them.
 *
 * **It disappears completely once the essentials are done.** A dialog that
 * lingers to nag about a logo is one people learn to dismiss unread, and then
 * it is not there when it matters.
 *
 * The whole must-have list, in order, with the finished ones kept
 * visible and settled. Seeing six struck-through lines above your two is the
 * difference between "there is a lot to do" and "you are nearly there", and it
 * costs nothing but the room to show them.
 */

import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useMe } from "@/hooks/useMe";
import { useSetupReadiness } from "@/hooks/useSetup";
import type { SetupCheck } from "@/types/setup";

/** One key per workspace, so switching companies in one browser is not confused. */
function dismissKey(userId: number | undefined, workspace: string) {
  return `hrms.setup-invitation.${workspace}.${userId ?? "anon"}`;
}

function readDismissed(key: string) {
  // Private windows and blocked site data throw on access rather than
  // returning null, so this cannot be a bare read. On the server there is no
  // storage at all — but nothing renders there either, because `me` and the
  // readiness both arrive from queries.
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export default function SetupInvitation() {
  const { data: me } = useMe();
  const { data: readiness } = useSetupReadiness();
  const router = useRouter();

  const canConfigure = Boolean(me?.permissions?.includes("settings.manage"));
  const workspace = typeof window === "undefined" ? "" : window.location.hostname;
  const key = dismissKey(me?.id, workspace);

  // The key contains the user id, and `me` is a query — undefined on the first
  // render. Read once into a `useState` initialiser the lookup would run
  // against a key ending in "anon", find nothing, and cache "not dismissed"
  // for the life of the component, so a dismissal would return on the next
  // navigation.
  //
  // So the stored value is read *during render*, against whatever the key is
  // now. It is a synchronous local read and this component renders a handful
  // of times, so there is nothing to save by caching it — and caching it is
  // precisely what broke it. `justDismissed` covers the same render pass, in
  // which the write has happened but this render was already scheduled.
  const [justDismissed, setJustDismissed] = useState<string | null>(null);
  const dismissed = justDismissed === key || readDismissed(key);

  // Never on top of `FirstPasswordGate`. Somebody still using a mailed
  // password owes that change first, and two modals at once means the one
  // underneath is dismissed unread. This waits its turn.
  if (me?.must_change_password) return null;
  if (!canConfigure || dismissed || !readiness || readiness.is_ready) return null;

  function remember() {
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      // Not being able to remember is survivable; showing it again is a much
      // smaller failure than refusing to close.
    }
    setJustDismissed(key);
  }

  /**
   * Every must-have, done ones first.
   *
   * **Done at the top, not interleaved.** A checklist that keeps its finished
   * items in their original positions makes the reader scan for the unticked
   * ones; grouping them turns the list into a progress bar you can read. The
   * next thing to do is then always the first unticked line.
   */
  const musts = readiness.tiers.must ?? [];
  const done = musts.filter((check) => check.done);
  const todo = musts.filter((check) => !check.done);
  const nextUp = todo[0];

  return (
    // `md`, not `sm`. Eight lines each carrying a title and a consequence need
    // the width to sit on one line apiece; at `sm` every `why` wrapped to three
    // and the list read as paragraphs.
    <Dialog open onClose={remember} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>Let&apos;s get your ready</DialogTitle>

      <DialogContent>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          These are the steps that decide whether people can actually be paid.
          {nextUp ? (
            <>
              {" "}
              Next up is <strong>{nextUp.title.toLowerCase()}</strong>.
            </>
          ) : null}
        </Typography>

        {/* The tracker: the count, the bar and what is left, in one line each
            rather than a bar with a number floating above it. */}
        <Box sx={{ mb: 2.5 }}>
          <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between", mb: 0.75 }}>
            <Typography sx={{ fontWeight: 800, fontSize: "1.05rem" }}>
              {readiness.must_done} of {readiness.must_total} done
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {todo.length} {todo.length === 1 ? "step" : "steps"} to go
            </Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={readiness.percent}
            sx={{ height: 8, borderRadius: 999 }}
          />
        </Box>

        <Stack spacing={0.25}>
          {todo.map((check, index) => (
            <CheckRow
              key={check.key}
              check={check}
              // Only the first is called out. Numbering all of them, or
              // highlighting all of them, is the same as highlighting none.
              next={index === 0}
              onGo={() => {
                remember();
                router.push(check.href);
              }}
            />
          ))}

          {done.length > 0 ? (
            <>
              <Typography
                variant="overline"
                sx={{ color: "text.disabled", pt: 1.5, pb: 0.5, display: "block" }}
              >
                Already done
              </Typography>
              {done.map((check) => (
                <CheckRow key={check.key} check={check} onGo={() => router.push(check.href)} />
              ))}
            </>
          ) : null}

          {todo.length === 0 && (
            <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", py: 1 }}>
              <CheckCircleIcon sx={{ fontSize: 18, color: "success.main" }} />
              <Typography variant="body2" color="text.secondary">
                Nothing essential is outstanding — what&apos;s left is the polish.
              </Typography>
            </Stack>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        {/* Plain, not a whisper. If "Later" looks like a way out of a trap,
            people take it without reading what they are declining. */}
        <Button onClick={remember} color="inherit">
          I&apos;ll do this later
        </Button>
        <Button
          variant="contained"
          endIcon={<ArrowForwardIcon />}
          onClick={() => {
            remember();
            router.push("/setup");
          }}
        >
          Set up the system
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * One line of the checklist.
 *
 * A finished step is struck through and settled back into the page rather than
 * removed: the strike is what makes the list read as progress, and keeping the
 * row clickable means somebody can go and check the thing they already did.
 */
function CheckRow({
  check,
  next,
  onGo,
}: {
  check: SetupCheck;
  next?: boolean;
  onGo: () => void;
}) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onGo}
      sx={{
        all: "unset",
        cursor: "pointer",
        display: "flex",
        gap: 1.25,
        alignItems: "flex-start",
        borderRadius: 1.5,
        px: 1.25,
        py: 1,
        mx: -1.25,
        bgcolor: next ? "action.hover" : "transparent",
        transition: "background-color 120ms",
        "&:hover": { bgcolor: "action.selected" },
        "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main" },
      }}
    >
      {check.done ? (
        <CheckCircleIcon sx={{ fontSize: 19, color: "success.main", mt: 0.15, flexShrink: 0 }} />
      ) : (
        <RadioButtonUncheckedIcon
          sx={{ fontSize: 19, color: next ? "primary.main" : "text.disabled", mt: 0.15, flexShrink: 0 }}
        />
      )}

      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Typography
            sx={{
              fontWeight: check.done ? 500 : 700,
              textDecoration: check.done ? "line-through" : "none",
              color: check.done ? "text.disabled" : "text.primary",
            }}
          >
            {check.title}
          </Typography>
          {next ? (
            <Box
              component="span"
              sx={{
                px: 0.75,
                py: 0.15,
                borderRadius: 999,
                fontSize: 10.5,
                fontWeight: 800,
                letterSpacing: ".04em",
                bgcolor: "primary.main",
                color: "primary.contrastText",
              }}
            >
              NEXT
            </Box>
          ) : null}
        </Stack>

        {/* The consequence, not the instruction. Somebody deciding whether to do
            this now needs to know what breaks if they don't, and the server
            already phrases it that way. Dropped once done — a warning about a
            thing that is handled is noise. */}
        {!check.done ? (
          <Typography variant="body2" color="text.secondary">
            {check.why}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}
