"use client";

import EmailIcon from "@mui/icons-material/Email";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SmsIcon from "@mui/icons-material/Sms";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Fade from "@mui/material/Fade";
import Paper from "@mui/material/Paper";
import Popper from "@mui/material/Popper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useRef, useState, type ReactNode } from "react";

import Link from "next/link";

import { useEmployeeProfile } from "@/hooks/useEmployeeProfile";
import { useCreateConversation } from "@/hooks/useChat";
import { employeeHref } from "@/lib/employeeProfile";
import { useUIStore } from "@/lib/store/ui";

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

const STATUS_COLOR: Record<string, "success" | "warning" | "default" | "error"> = {
  active: "success",
  on_leave: "warning",
  resigned: "default",
  terminated: "error",
};

type Props = {
  employeeId: number | null | undefined;
  /** Falls back as the avatar's initials until the profile resolves. */
  name: string;
  children: ReactNode;
  /** `inline` for text inside a sentence; `block` when wrapping a tile or row. */
  display?: "inline-flex" | "block" | "contents";
};

/**
 * Wraps anything in a hover-triggered profile card.
 *
 * **Why a wrapper and not just a link.** The card started life inside
 * `EmployeeLink`, which renders a name as text — so only components that showed
 * a bare name could have it. Everything that presented a person as something
 * richer got nothing: the on-leave tiles, the check-in feed, birthdays, the
 * activity stream. Sixteen of the eighteen dashboard components showed people
 * with no card at all, and the two that had one were the two that happened to
 * render a plain string.
 *
 * Several of those are already links or clickable tiles, so the card could not
 * simply be `EmployeeLink` nested inside them — that puts an anchor inside an
 * anchor, which is invalid and makes the click target ambiguous. Wrapping is
 * the shape that works for both: the child stays whatever it already was.
 *
 * The profile is only fetched once the pointer has lingered, so dropping this
 * into a 200-row grid costs nothing until someone actually hovers a name.
 */
export default function PersonHoverCard({ employeeId, name, children, display = "inline-flex" }: Props) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: profile, isLoading } = useEmployeeProfile(open ? (employeeId ?? null) : null);
  const createConversation = useCreateConversation();
  const openChatConversation = useUIStore((s) => s.openChatConversation);

  // No id means no profile to show — render the child untouched rather than
  // attaching handlers that would open an empty card.
  if (employeeId == null) return <>{children}</>;

  function scheduleOpen(el: HTMLElement) {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    // 300ms of hover intent: without it, dragging the pointer across a grid of
    // names fires a card per name and a request per card.
    openTimer.current = setTimeout(() => {
      setAnchorEl(el);
      setOpen(true);
    }, 300);
  }

  function scheduleClose() {
    if (openTimer.current) clearTimeout(openTimer.current);
    // Short grace period so the pointer can travel from the name onto the card
    // without it closing underneath.
    closeTimer.current = setTimeout(() => setOpen(false), 160);
  }

  async function startDm() {
    if (!profile) return;
    const conv = await createConversation.mutateAsync({ type: "dm", member_ids: [profile.user_id] });
    openChatConversation(conv.id);
    setOpen(false);
  }

  return (
    <>
      <Box
        component="span"
        sx={{ display, minWidth: 0 }}
        onMouseEnter={(e) => scheduleOpen(e.currentTarget)}
        onMouseLeave={scheduleClose}
      >
        {children}
      </Box>

      <Popper
        open={open && Boolean(anchorEl)}
        anchorEl={anchorEl}
        placement="bottom-start"
        transition
        style={{ zIndex: 1400 }}
        modifiers={[{ name: "offset", options: { offset: [0, 6] } }]}
      >
        {({ TransitionProps }) => (
          <Fade {...TransitionProps} timeout={140}>
            <Paper
              elevation={8}
              onMouseEnter={() => {
                if (closeTimer.current) clearTimeout(closeTimer.current);
              }}
              onMouseLeave={scheduleClose}
              sx={{ width: 300, borderRadius: 3, overflow: "hidden" }}
            >
              <Box
                sx={{
                  height: 56,
                  background: profile?.cover_image
                    ? `url(${profile.cover_image}) ${profile.cover_position ?? "50% 50%"}/cover`
                    : "var(--hrms-gradient-profile)",
                }}
              />
              <Box sx={{ px: 2, pb: 2, mt: "-28px" }}>
                <Avatar
                  src={profile?.photo ?? undefined}
                  sx={{ width: 56, height: 56, border: "3px solid", borderColor: "background.paper" }}
                >
                  {initials(name)}
                </Avatar>

                {isLoading || !profile ? (
                  <Box sx={{ py: 2, display: "flex", justifyContent: "center" }}>
                    <CircularProgress size={22} />
                  </Box>
                ) : (
                  <>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: 1 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1, minWidth: 0 }} noWrap>
                        {profile.full_name}
                      </Typography>
                      <Chip
                        size="small"
                        label={profile.employment_status.replace("_", " ")}
                        color={STATUS_COLOR[profile.employment_status] ?? "default"}
                      />
                    </Stack>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {profile.designation_title ?? "—"}
                      {profile.department_name ? ` · ${profile.department_name}` : ""}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {profile.employee_code}
                    </Typography>

                    {(profile.email || profile.phone) && (
                      <Stack spacing={0.25} sx={{ mt: 1 }}>
                        {profile.email && (
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {profile.email}
                          </Typography>
                        )}
                        {profile.phone && (
                          <Typography variant="caption" color="text.secondary">
                            {profile.phone}
                          </Typography>
                        )}
                      </Stack>
                    )}

                    <Divider sx={{ my: 1.5 }} />
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<SmsIcon />}
                        onClick={startDm}
                        disabled={createConversation.isPending}
                      >
                        Message
                      </Button>
                      {profile.email && (
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<EmailIcon />}
                          href={`mailto:${profile.email}`}
                        >
                          Email
                        </Button>
                      )}
                      <Box sx={{ flex: 1 }} />
                      <Button
                        size="small"
                        component={Link}
                        href={employeeHref(employeeId)}
                        endIcon={<OpenInNewIcon />}
                      >
                        Profile
                      </Button>
                    </Stack>
                  </>
                )}
              </Box>
            </Paper>
          </Fade>
        )}
      </Popper>
    </>
  );
}
