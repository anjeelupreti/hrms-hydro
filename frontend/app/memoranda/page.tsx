"use client";

import AddIcon from "@mui/icons-material/Add";
import AssignmentIcon from "@mui/icons-material/Assignment";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import HistoryIcon from "@mui/icons-material/History";
import InboxIcon from "@mui/icons-material/Inbox";
import SettingsIcon from "@mui/icons-material/Settings";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import Link from "next/link";
import { useState } from "react";

import DateText from "@/components/common/DateText";
import EmptyState from "@/components/common/EmptyState";
import PageToolbar from "@/components/common/PageToolbar";
import StateChip from "@/components/common/StateChip";
import MemorandumDialog from "@/components/memoranda/MemorandumDialog";
import Breadcrumbs from "@/components/shell/Breadcrumbs";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import { useMemorandum, useMemorandumDesk, useMemoranda } from "@/hooks/useMemoranda";
import { useCan } from "@/hooks/useMe";
import { MEMO_STATUS_TONE, type MemorandumListItem } from "@/types/memoranda";

/**
 * Memoranda, arranged by what they need from the person reading the page.
 *
 * **Three sections, and the order is the whole design.** *Needs you* is at the
 * top because a memorandum sitting on somebody's desk that they do not know
 * about is the failure of the paper system this replaces. *Raised by you* is
 * next, because the second question anybody asks is where their own has got to.
 * *You have handled* is last and is history — it is where somebody goes to find
 * the note they signed in Poush.
 *
 * The three come down in one request, so they cannot disagree about the same
 * memorandum — one showing it as waiting while another has it as done.
 */

export default function MemorandaPage() {
  const canConfigure = useCan("settings.manage");
  const { data: desk, isLoading } = useMemorandumDesk();

  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const { data: open, isLoading: loadingOne } = useMemorandum(openId);

  // The search runs across everything visible rather than filtering the three
  // sections, because somebody searching has stopped asking "what needs me"
  // and started asking "where is that one about the access road".
  const { data: searched, isLoading: searching } = useMemoranda(
    search ? { search } : { pageSize: 1 }
  );

  const awaiting = desk?.awaiting_me ?? [];

  return (
    <PageContainer>
      <Breadcrumbs />
      <PageHeader
        title="Memoranda"
        subtitle="Proposals that go up the chain for recommendation and approval"
        icon={<AssignmentIcon />}
        actions={
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }} useFlexGap>
            {canConfigure ? (
              <Button
                component={Link}
                href="/settings/memorandum-actions"
                startIcon={<SettingsIcon />}
              >
                Actions
              </Button>
            ) : null}
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
              New memorandum
            </Button>
          </Stack>
        }
      />

      <PageToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Number, subject or content…"
        searchLabel="Search memoranda by number, subject or content"
      />

      {search ? (
        <Section
          title={`Matching “${search}”`}
          icon={<HistoryIcon fontSize="small" />}
          items={searched?.results ?? []}
          loading={searching}
          emptyText="Nothing matches."
          onOpen={setOpenId}
        />
      ) : isLoading ? (
        <Stack spacing={2}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} variant="rounded" height={96} />
          ))}
        </Stack>
      ) : (
        <Stack spacing={4}>
          <Section
            title="Needs you"
            icon={
              <Badge badgeContent={awaiting.length} color="warning">
                <InboxIcon fontSize="small" />
              </Badge>
            }
            items={awaiting}
            emptyText="Nothing is waiting on you."
            onOpen={setOpenId}
            highlight
          />
          <Section
            title="Raised by you"
            icon={<AssignmentIcon fontSize="small" />}
            items={desk?.mine ?? []}
            emptyText="You have not raised any."
            onOpen={setOpenId}
          />
          <Section
            title="You have handled"
            icon={<HistoryIcon fontSize="small" />}
            items={desk?.handled ?? []}
            emptyText="Nothing yet."
            onOpen={setOpenId}
            muted
          />
        </Stack>
      )}

      <MemorandumDialog
        open={creating}
        memo={null}
        onClose={() => setCreating(false)}
        // Saving a new draft reopens it as itself rather than closing. Files
        // attach to a memorandum, so until it has been saved once there is
        // nothing to attach them to — closing here left the initiator with a
        // draft and no way back into it except finding it in the list below.
        onCreated={(id) => {
          setCreating(false);
          setOpenId(id);
        }}
      />
      <MemorandumDialog
        open={openId !== null}
        memo={open ?? null}
        loading={loadingOne}
        onClose={() => setOpenId(null)}
      />
    </PageContainer>
  );
}

function Section({
  title,
  icon,
  items,
  emptyText,
  onOpen,
  loading = false,
  highlight = false,
  muted = false,
}: {
  title: string;
  icon: React.ReactNode;
  items: MemorandumListItem[];
  emptyText: string;
  onOpen: (id: number) => void;
  loading?: boolean;
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1.5 }}>
        {icon}
        <Typography variant="overline" color="text.secondary">
          {title}
        </Typography>
        <Chip size="small" label={items.length} />
      </Stack>

      {loading ? (
        <Skeleton variant="rounded" height={90} />
      ) : items.length === 0 ? (
        <EmptyState title={emptyText} description="" compact />
      ) : (
        <Stack spacing={1.5}>
          {items.map((memo) => (
            <Card
              key={memo.id}
              sx={(theme) => ({
                opacity: muted ? 0.9 : 1,
                borderLeft: highlight ? "3px solid" : undefined,
                borderColor: highlight ? theme.palette.warning.main : undefined,
                bgcolor: muted ? alpha(theme.palette.text.primary, 0.015) : undefined,
              })}
            >
              <CardActionArea onClick={() => onOpen(memo.id)}>
                <CardContent sx={{ py: 1.5 }}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: "baseline", flexWrap: "wrap" }}
                    useFlexGap
                  >
                    <Typography sx={{ fontWeight: 700 }}>{memo.subject}</Typography>
                    <StateChip label={memo.status_display} tone={MEMO_STATUS_TONE[memo.status]} />
                    {memo.attachment_count > 0 ? (
                      <Chip
                        size="small"
                        variant="outlined"
                        icon={<AttachFileIcon />}
                        label={memo.attachment_count}
                      />
                    ) : null}
                  </Stack>
                  <Stack
                    direction="row"
                    spacing={1.5}
                    sx={{ mt: 0.5, color: "text.secondary", flexWrap: "wrap" }}
                    useFlexGap
                  >
                    <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                      {memo.memo_id ?? "draft"}
                    </Typography>
                    <Typography variant="caption">{memo.company_name}</Typography>
                    <Typography variant="caption">
                      <DateText value={memo.memo_date} />
                    </Typography>
                    <Typography variant="caption">by {memo.initiator_name}</Typography>
                    {memo.current_holder_name ? (
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>
                        → {memo.current_holder_name}
                      </Typography>
                    ) : null}
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Stack>
      )}
    </Box>
  );
}
