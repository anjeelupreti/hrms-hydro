"use client";

/**
 * Everything waiting on you, in one row.
 *
 * One strip for everything that means "something needs you" — a setup warning,
 * pending change requests, approvals waiting. Given a banner each they are
 * ~450px of prose before the first number on the dashboard: individually
 * reasonable, and the stack is not.
 *
 * **Named, not counted.** "3 pending" says how much work there is; "2 need
 * care" says whether it can wait. Each item carries the one detail that decides
 * whether you click now, and nothing else — the queue behind it is where the
 * detail lives.
 *
 * **It disappears entirely when there is nothing.** A strip reading "0 · 0 · 0"
 * every morning is one people stop seeing, and then it is not there on the day
 * it says 1.
 */

import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ManageAccountsIcon from "@mui/icons-material/ManageAccounts";
import RuleFolderIcon from "@mui/icons-material/RuleFolder";
import SettingsSuggestIcon from "@mui/icons-material/SettingsSuggest";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import type { ReactNode } from "react";

import { useChangeRequests } from "@/hooks/useChangeRequests";
import { useCan } from "@/hooks/useMe";
import { useSetupReadiness } from "@/hooks/useSetup";

type Item = {
  key: string;
  href: string;
  icon: ReactNode;
  /** The count, big. */
  value: string;
  /** What the count is of. */
  label: string;
  /** The one detail that decides whether this can wait. */
  detail: string;
  /** Warning items are the ones that block money or need a second pair of eyes. */
  urgent?: boolean;
};

export default function AttentionBar({ pendingApprovals }: { pendingApprovals: number }) {
  const canManageSettings = useCan("settings.manage");
  const canManagePeople = useCan("people.manage");
  const { data: readiness } = useSetupReadiness();
  const { data: changeRequests } = useChangeRequests({ status: "pending" });

  const items: Item[] = [];

  if (readiness && !readiness.is_ready && canManageSettings) {
    const next = readiness.blocking[0];
    items.push({
      key: "setup",
      href: "/setup",
      icon: <SettingsSuggestIcon fontSize="small" />,
      value: `${readiness.must_done}/${readiness.must_total}`,
      label: "setup steps done",
      // The next step by name. "4 remaining" tells somebody how much is left;
      // the title tells them what to do now.
      detail: next ? `Next: ${next.title.toLowerCase()}` : "Payroll cannot run until these are done",
      urgent: true,
    });
  }

  const requests = changeRequests?.results ?? [];
  if (canManagePeople && requests.length > 0) {
    const sensitive = requests.filter((request) => request.is_sensitive);
    items.push({
      key: "change-requests",
      href: "/change-requests",
      icon: <ManageAccountsIcon fontSize="small" />,
      value: `${requests.length}`,
      label: requests.length === 1 ? "change request" : "change requests",
      // A bank-account change sits between an employee asking and their salary
      // going somewhere new. That is the fact that decides the ordering.
      detail:
        sensitive.length > 0
          ? `${sensitive.length} touch pay or identity`
          : requests.map((request) => request.employee_name).slice(0, 2).join(", "),
      urgent: sensitive.length > 0,
    });
  }

  if (pendingApprovals > 0) {
    items.push({
      key: "approvals",
      href: "/leave",
      icon: <RuleFolderIcon fontSize="small" />,
      value: `${pendingApprovals}`,
      label: pendingApprovals === 1 ? "request awaiting you" : "requests awaiting you",
      detail: "Leave, remote work and overtime",
    });
  }

  if (items.length === 0) return null;

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "1fr",
          sm: `repeat(${Math.min(items.length, 2)}, 1fr)`,
          md: `repeat(${items.length}, 1fr)`,
        },
        gap: 1.5,
        mb: 2.5,
      }}
    >
      {items.map((item) => (
        <Stack
          key={item.key}
          component={Link}
          href={item.href}
          direction="row"
          spacing={1.5}
          sx={{
            alignItems: "center",
            px: 1.75,
            py: 1.25,
            borderRadius: 2,
            border: "1px solid",
            // Urgency is carried by the left edge and the icon, not by a filled
            // amber panel: three filled warnings in a row is a page that looks
            // like an incident, and then a real one has nowhere louder to go.
            borderColor: item.urgent ? "warning.main" : "divider",
            bgcolor: item.urgent
              ? "color-mix(in srgb, var(--mui-palette-warning-main) 10%, transparent)"
              : "background.paper",
            color: "text.primary",
            textDecoration: "none",
            transition: "background-color .15s",
            "&:hover": { bgcolor: "action.hover" },
          }}
        >
          <Box
            sx={{
              display: "grid",
              placeItems: "center",
              width: 32,
              height: 32,
              flexShrink: 0,
              borderRadius: 1.5,
              bgcolor: item.urgent ? "warning.main" : "action.selected",
              color: item.urgent ? "warning.contrastText" : "text.secondary",
            }}
          >
            {item.icon}
          </Box>

          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: "baseline" }}>
              <Typography sx={{ fontWeight: 800, fontSize: "1.05rem", lineHeight: 1.1 }}>
                {item.value}
              </Typography>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {item.label}
              </Typography>
            </Stack>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                display: "block",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.detail}
            </Typography>
          </Box>

          <ArrowForwardIcon sx={{ fontSize: 16, color: "text.disabled", flexShrink: 0 }} />
        </Stack>
      ))}
    </Box>
  );
}
