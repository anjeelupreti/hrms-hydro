"use client";

import AddIcon from "@mui/icons-material/Add";
import CampaignIcon from "@mui/icons-material/Campaign";
import PushPinIcon from "@mui/icons-material/PushPin";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import AnnouncementReach from "@/components/announcements/AnnouncementReach";
import BoardState from "@/components/announcements/BoardState";
import ComposeAnnouncement from "@/components/announcements/ComposeAnnouncement";
import NoticeCard from "@/components/announcements/NoticeCard";
import ReadReceipts from "@/components/announcements/ReadReceipts";
import EmptyState from "@/components/common/EmptyState";
import ListControls from "@/components/common/ListControls";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import {
  useAnnouncements,
  useArchive,
  useDeleteAnnouncement,
} from "@/hooks/useCollaboration";
import { useCan } from "@/hooks/useMe";
import { useTextFilter } from "@/hooks/useTextFilter";

/** A heading over a run of cards, so the two bands read as two bands. */
function BandHeading({ icon, label, count }: { icon?: React.ReactNode; label: string; count: number }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: 1 }}>
      {icon}
      <Typography variant="overline" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="overline" color="text.disabled">
        {count}
      </Typography>
    </Stack>
  );
}

export default function AnnouncementsPage() {
  const canManage = useCan("workplace.manage");
  const [showArchived, setShowArchived] = useState(false);
  const { data: announcements, isLoading } = useAnnouncements(false, showArchived);
  const archive = useArchive("notifications/announcements", "announcements");
  const deleteAnnouncement = useDeleteAnnouncement();

  const [dialogOpen, setDialogOpen] = useState(false);
  /** The notice whose read-receipts are open — the author's own view. */
  const [receiptsFor, setReceiptsFor] = useState<number | null>(null);

  /**
   * Opened straight from the top bar's quick action.
   *
   * Read once on mount rather than watched: this is an instruction carried in
   * from elsewhere, not a piece of state the URL owns — leaving it live would
   * reopen the composer every time somebody closed it.
   */
  const params = useSearchParams();
  const [composeHandled, setComposeHandled] = useState(false);
  if (!composeHandled && params.get("compose") === "1") {
    setComposeHandled(true);
    setDialogOpen(true);
  }

  const { query, setQuery, filtered, isEmptyResult } = useTextFilter(
    announcements?.results ?? [],
    (a) => [a.title, a.body, a.department_name, a.posted_by]
  );

  /**
   * **Pinned notices get their own band, not a sort order.**
   *
   * They were sorted to the top and drawn identically to everything under
   * them, so the one thing pinning is *for* — being unmissable — depended on
   * the reader noticing a small icon and inferring why that card came first.
   * A heading says it.
   */
  const pinned = filtered.filter((a) => a.pinned);
  const rest = filtered.filter((a) => !a.pinned);

  const cardProps = (announcement: (typeof filtered)[number]) => ({
    announcement,
    canManage: Boolean(canManage),
    archived: showArchived,
    onArchiveToggle: () => archive.mutate({ id: announcement.id, archived: showArchived }),
    onDelete: () => deleteAnnouncement.mutate(announcement.id),
    onOpenReceipts: () => setReceiptsFor(announcement.id),
  });

  return (
    <PageContainer>
      <PageHeader
        title="Announcements"
        subtitle="The company noticeboard — who said it, who it was for, and who has read it"
        icon={<CampaignIcon />}
        actions={
          canManage ? (
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
              New announcement
            </Button>
          ) : null
        }
      />

      <ListControls
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search announcements…"
        searchLabel="Search announcements by title, body, department or author"
      />

      {/* Live and archived, side by side. Deleting a notice destroys the
          record that it was ever posted; archiving keeps it and takes it out
          of the way, which is what somebody actually wants of last festival's
          greeting. */}
      <Tabs
        value={showArchived ? 1 : 0}
        onChange={(_e, v) => setShowArchived(v === 1)}
        sx={{ mb: 2 }}
      >
        <Tab label="Current" />
        <Tab label="Archived" />
      </Tabs>

      {/* The state of the board, before the board. Only on the current tab:
          counting expiries across the archive would describe notices that have
          already been taken down on purpose. Read against every notice rather
          than the search results — a permanent notice is still permanent when
          a filter hides it. */}
      {isLoading || showArchived ? null : (
        <BoardState announcements={announcements?.results ?? []} />
      )}

      <Stack spacing={2}>
        {pinned.length > 0 ? (
          <>
            <BandHeading
              icon={<PushPinIcon fontSize="small" color="primary" />}
              label="Pinned"
              count={pinned.length}
            />
            {pinned.map((announcement) => (
              <NoticeCard key={announcement.id} {...cardProps(announcement)} />
            ))}
          </>
        ) : null}

        {rest.length > 0 ? (
          <>
            {pinned.length > 0 ? (
              <BandHeading label={showArchived ? "Archived" : "Everything else"} count={rest.length} />
            ) : null}
            {rest.map((announcement) => (
              <NoticeCard key={announcement.id} {...cardProps(announcement)} />
            ))}
          </>
        ) : null}

        {!isLoading && filtered.length === 0 && (
          <EmptyState
            variant={isEmptyResult ? "noResults" : "empty"}
            title={isEmptyResult ? `No announcements match “${query}”` : "No announcements yet"}
            description={
              isEmptyResult
                ? "Try a different search, or clear it to see everything."
                : "Post company-wide or department notices. Pin the ones that should stay at the top."
            }
            surface
          />
        )}
      </Stack>

      <ComposeAnnouncement open={dialogOpen} onClose={() => setDialogOpen(false)} />
      <ReadReceipts announcementId={receiptsFor} onClose={() => setReceiptsFor(null)} />
    </PageContainer>
  );
}
