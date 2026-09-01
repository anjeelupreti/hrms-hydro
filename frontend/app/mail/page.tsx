"use client";

import MailOutlineIcon from "@mui/icons-material/Email";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useQueryClient } from "@tanstack/react-query";
import NextLink from "next/link";
import { useState } from "react";

import EmptyState from "@/components/common/EmptyState";
import ComposeDialog, { type ComposeInitial } from "@/components/mail/ComposeDialog";
import MailList from "@/components/mail/MailList";
import MailReader from "@/components/mail/MailReader";
import { mailKey, useEmails, useSyncInbox } from "@/hooks/useMail";
import { useCan, useMe } from "@/hooks/useMe";
import { useEmailSettings } from "@/hooks/useOrganization";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import type { EmailFolder, EmailListItem } from "@/types/mail";

const EMPTY_COMPOSE: ComposeInitial = { to: "", subject: "", body: "" };

export default function MailPage() {
  const [folder, setFolder] = useState<EmailFolder>("inbox");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [compose, setCompose] = useState<{ open: boolean; initial: ComposeInitial }>({
    open: false,
    initial: EMPTY_COMPOSE,
  });

  const { data: emails } = useEmails(folder);
  const syncInbox = useSyncInbox();
  const queryClient = useQueryClient();

  const { data: me } = useMe();
  const isHR = useCan("settings.manage");
  // Only read by somebody who could act on it — an employee seeing "no mailbox
  // connected" can do nothing but wonder who to tell.
  const { data: settings } = useEmailSettings(isHR);

  // Opening a message marks it read server-side (the detail GET does it).
  // Reflect that immediately in the list + nav badge instead of waiting for
  // a refetch, so the bold-unread styling clears the moment you click.
  function openMessage(id: number) {
    setSelectedId(id);
    const wasUnread =
      folder === "inbox" && emails?.some((m) => m.id === id && !m.is_read);
    if (!wasUnread) return;
    queryClient.setQueryData<EmailListItem[]>(mailKey("inbox"), (old) =>
      old?.map((m) => (m.id === id ? { ...m, is_read: true } : m))
    );
    queryClient.setQueryData<{ count: number }>(["mail", "unread-count"], (old) =>
      old ? { count: Math.max(0, old.count - 1) } : old
    );
  }

  if (me && !isHR) {
    return (
      <Stack sx={{ height: "60dvh", alignItems: "center", justifyContent: "center", p: 4 }}>
        <Typography variant="h6">Company mailbox</Typography>
        <Typography color="text.secondary" sx={{ textAlign: "center", mt: 1 }}>
          The company mailbox is available to HR admins only.
        </Typography>
      </Stack>
    );
  }

  function selectFolder(next: EmailFolder) {
    setFolder(next);
    setSelectedId(null);
  }

  function openReply(to: string, subject: string) {
    const prefixed = subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`;
    setCompose({ open: true, initial: { to, subject: prefixed, body: "" } });
  }

  return (
    <PageContainer>
      <PageHeader
        title="Mail"
        subtitle="The system's shared mailbox"
        icon={<MailOutlineIcon />}
      />

      {/* Until an IMAP host is configured there is nothing for Sync to reach,
          so the empty state says which it is — unconfigured, not broken — and
          links to the screen that fixes it. */}
      {isHR && settings && !settings.imap_host ? (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" component={NextLink} href="/settings/email">
              Set it up
            </Button>
          }
        >
          No mailbox is connected yet, so there is nothing to sync. Add an IMAP host in
          email settings and the inbox will start filling.
        </Alert>
      ) : null}

      <Paper
        variant="outlined"
        sx={{
          display: "flex",
          height: "calc(100dvh - 260px)",
          minHeight: 460,
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
      <Box
        sx={{
          width: { xs: "100%", md: 380 },
          flexShrink: 0,
          borderRight: { md: "1px solid" },
          borderColor: { md: "divider" },
          display: { xs: selectedId ? "none" : "block", md: "block" },
        }}
      >
        <MailList
          folder={folder}
          onFolderChange={selectFolder}
          emails={emails ?? []}
          selectedId={selectedId}
          onSelect={openMessage}
          onSync={() => syncInbox.mutate()}
          syncing={syncInbox.isPending}
          onCompose={() => setCompose({ open: true, initial: EMPTY_COMPOSE })}
        />
      </Box>

      <Box sx={{ flex: 1, minWidth: 0, display: { xs: selectedId ? "flex" : "none", md: "flex" } }}>
        {selectedId ? (
          <MailReader messageId={selectedId} onBack={() => setSelectedId(null)} onReply={openReply} />
        ) : (
          <Stack sx={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <EmptyState
              variant="empty"
              title="Nothing open"
              description="Pick a message from the list to read it here."
              compact
            />
          </Stack>
        )}
      </Box>

      </Paper>

      <ComposeDialog
        open={compose.open}
        initial={compose.initial}
        onClose={() => setCompose((c) => ({ ...c, open: false }))}
        onSent={() => setFolder("sent")}
      />
    </PageContainer>
  );
}
