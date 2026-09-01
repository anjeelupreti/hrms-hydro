"use client";

import ApartmentIcon from "@mui/icons-material/Apartment";
import BusinessIcon from "@mui/icons-material/Business";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import CreditCardIcon from "@mui/icons-material/CreditCard";
import EmailIcon from "@mui/icons-material/Email";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import FingerprintIcon from "@mui/icons-material/Fingerprint";
import NotificationsIcon from "@mui/icons-material/Notifications";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Link from "next/link";

import { useSetupReadiness } from "@/hooks/useSetup";

/**
 * The settings index, grouped — and saying what is already configured.
 *
 * Grouped and weighted rather than eleven identical tiles in one flat grid.
 * "Finish setup" is a task with an end and "Payroll components" is a thing you
 * tend forever, and a flat grid draws them the same size, weight and colour.
 *
 * **Four groups, in the order the system needs them** — the company and its
 * structure, then time, then money, then how it talks to people. Grouping is
 * not decoration here: "where would that setting live" is the only question
 * anybody brings to a settings index, and a flat list of eleven refuses to
 * answer it.
 *
 * **The state dot is the other half.** Eleven doors that look alike have to be
 * opened one by one to find out which you have been through. Where a setup
 * check points at a destination, the row says whether it is done, so the page
 * can be read instead of audited.
 */

type LinkSpec = { href: string; icon: React.ReactNode; title: string; desc: string };

const GROUPS: { label: string; hint: string; links: LinkSpec[] }[] = [
  {
    label: "Company",
    hint: "Who you are, and the structure every employee record is filed under.",
    links: [
      {
        href: "/settings/company",
        icon: <BusinessIcon />,
        title: "Company profile",
        desc: "Name, logo, fiscal calendar, working days, payroll proration, retirement fund.",
      },
      {
        href: "/settings/org",
        icon: <ApartmentIcon />,
        title: "Departments & job titles",
        desc: "The structure every employee record is filed under.",
      },
    ],
  },
  {
    label: "Time",
    hint: "When people are expected, and how the system knows they were there.",
    links: [
      {
        href: "/settings/attendance",
        icon: <FingerprintIcon />,
        title: "How people clock in",
        desc: "Which methods this company accepts, and who is an exception.",
      },
      {
        href: "/settings/devices",
        icon: <FingerprintIcon />,
        title: "Attendance devices",
        desc: "Register biometric terminals and issue their push tokens.",
      },
      {
        href: "/settings/holidays",
        icon: <CalendarMonthIcon />,
        title: "Holidays",
        desc: "The company holiday calendar.",
      },
      {
        href: "/leave",
        icon: <EventAvailableIcon />,
        title: "Leave types",
        desc: "Quotas, carry-forward and approval policy.",
      },
    ],
  },
  {
    label: "Money",
    hint: "What people are paid, and what you pay us.",
    links: [
      {
        href: "/payroll/components",
        icon: <ReceiptLongIcon />,
        title: "Payroll components",
        desc: "Earnings, deductions and tax slabs.",
      },
      {
        href: "/settings/billing",
        icon: <CreditCardIcon />,
        title: "Billing & subscription",
        desc: "Your plan, invoices and payment methods.",
      },
    ],
  },
  {
    label: "Communication",
    hint: "How the system reaches people.",
    links: [
      {
        href: "/settings/email",
        icon: <EmailIcon />,
        title: "Email (SMTP / IMAP)",
        desc: "Send and receive under your own mail server.",
      },
      {
        href: "/settings/reminders",
        icon: <NotificationsIcon />,
        title: "Reminders",
        desc: "What the company warns people about, and how far ahead.",
      },
    ],
  },
];

/**
 * One destination.
 *
 * A destination with no matching setup check gets **no dot at all**, rather
 * than a neutral one: an empty circle beside "Email" would read as "not
 * configured", when the truth is that nothing here knows either way.
 */
function OrgLink({ href, icon, title, desc, state }: LinkSpec & { state?: "done" | "todo" }) {
  return (
    <Grid size={{ xs: 12, sm: 6 }}>
      <Card
        variant="outlined"
        sx={{
          height: "100%",
          transition: "box-shadow .2s, border-color .2s",
          "&:hover": { boxShadow: 4, borderColor: "primary.main" },
        }}
      >
        <CardContent
          component={Link}
          href={href}
          sx={{
            display: "flex",
            gap: 1.5,
            alignItems: "flex-start",
            textDecoration: "none",
            color: "inherit",
            py: 1.75,
          }}
        >
          <Avatar
            variant="rounded"
            sx={{
              width: 34,
              height: 34,
              bgcolor: "transparent",
              color: "primary.main",
              border: "1.5px solid",
              borderColor: "primary.main",
              flexShrink: 0,
            }}
          >
            {icon}
          </Avatar>
          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {title}
              </Typography>
              {state ? (
                <Tooltip title={state === "done" ? "Configured" : "Not set up yet"}>
                  <Box
                    sx={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      flexShrink: 0,
                      ...(state === "done"
                        ? { bgcolor: "var(--hrms-status-success-solid)" }
                        : {
                            border: "1.5px solid",
                            borderColor: "var(--hrms-status-warning-solid)",
                          }),
                    }}
                  />
                </Tooltip>
              ) : null}
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {desc}
            </Typography>
          </Box>
        </CardContent>
      </Card>
    </Grid>
  );
}

export default function OrganizationTab() {
  const { data: readiness } = useSetupReadiness();

  // A destination counts as done only when every check aimed at it is done or
  // deliberately skipped. One outstanding check is the reason to go there, so
  // it should not be averaged away by the others.
  const stateFor = (href: string): "done" | "todo" | undefined => {
    if (!readiness) return undefined;
    const checks = [
      ...readiness.tiers.must,
      ...readiness.tiers.recommended,
      ...readiness.tiers.advanced,
    ].filter((check) => check.href === href);
    if (checks.length === 0) return undefined;
    return checks.every((check) => check.done || check.skipped) ? "done" : "todo";
  };

  return (
    <Stack spacing={3.5}>
      {/* Setup leads, and not as a tile. It is the one entry here that
          finishes, so it is a banner while unfinished and a single line once
          done — rather than sitting in the grid forever looking like a
          permanent department of the product. */}
      {readiness && !readiness.is_ready ? (
        <Card variant="outlined" sx={{ borderColor: "var(--hrms-status-warning-solid)" }}>
          <CardContent
            component={Link}
            href="/setup"
            sx={{ display: "flex", gap: 1.5, alignItems: "center", textDecoration: "none", color: "inherit" }}
          >
            <Avatar
              variant="rounded"
              sx={{
                bgcolor: "transparent",
                color: "var(--hrms-status-warning-fg)",
                border: "1.5px solid",
                borderColor: "var(--hrms-status-warning-solid)",
              }}
            >
              <RocketLaunchIcon />
            </Avatar>
            <Box sx={{ flexGrow: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Finish setup — {readiness.must_done} of {readiness.must_total} done
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {readiness.blocking.length > 0
                  ? `${readiness.blocking[0].title} still blocks a first payroll.`
                  : "What still needs configuring before anyone can be paid."}
              </Typography>
            </Box>
          </CardContent>
        </Card>
      ) : null}

      {GROUPS.map((group) => (
        <Box key={group.label}>
          <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
            {group.label}
          </Typography>
          <Typography variant="caption" color="text.disabled" sx={{ display: "block", mb: 1.5 }}>
            {group.hint}
          </Typography>
          <Grid container spacing={2}>
            {group.links.map((link) => (
              <OrgLink key={link.href} {...link} state={stateFor(link.href)} />
            ))}
          </Grid>
        </Box>
      ))}

      {/* Done, but still reachable: somebody deletes a salary structure and
          needs to find the checklist again. */}
      {readiness?.is_ready ? (
        <Box
          component={Link}
          href="/setup"
          sx={{
            fontSize: 13,
            color: "text.secondary",
            textDecoration: "none",
            "&:hover": { color: "primary.main" },
          }}
        >
          Setup checklist — all {readiness.must_total} must-haves done ›
        </Box>
      ) : null}
    </Stack>
  );
}
