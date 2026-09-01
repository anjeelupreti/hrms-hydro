"use client";

import AddIcon from "@mui/icons-material/Add";
import CampaignIcon from "@mui/icons-material/Campaign";
import DeleteIcon from "@mui/icons-material/Delete";
import PushPinIcon from "@mui/icons-material/PushPin";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import ArchiveIcon from "@mui/icons-material/Archive";
import UnarchiveIcon from "@mui/icons-material/Unarchive";
import IconButton from "@mui/material/IconButton";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import BoardState from "@/components/announcements/BoardState";
import EmptyState from "@/components/common/EmptyState";
import SearchField from "@/components/common/SearchField";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import {
  useAnnouncements,
  useArchive,
  useCreateAnnouncement,
  useDeleteAnnouncement,
} from "@/hooks/useCollaboration";
import { useCan } from "@/hooks/useMe";
import { useTextFilter } from "@/hooks/useTextFilter";
import { DepartmentPicker } from "@/components/common/pickers";

export default function AnnouncementsPage() {
  const canManage = useCan("workplace.manage");
  const [showArchived, setShowArchived] = useState(false);
  const { data: announcements, isLoading } = useAnnouncements(false, showArchived);
  const archive = useArchive("notifications/announcements", "announcements");
  const createAnnouncement = useCreateAnnouncement();
  const deleteAnnouncement = useDeleteAnnouncement();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [department, setDepartment] = useState<number | "">("");
  const [pinned, setPinned] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { query, setQuery, filtered, isEmptyResult } = useTextFilter(
    announcements?.results ?? [],
    (a) => [a.title, a.body, a.department_name, a.posted_by]
  );

  async function handleCreate() {
    setError(null);
    try {
      await createAnnouncement.mutateAsync({
        title,
        body,
        department: department || null,
        pinned,
      });
      setDialogOpen(false);
      setTitle("");
      setBody("");
      setDepartment("");
      setPinned(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Announcements"
        subtitle="Company and department notices"
        icon={<CampaignIcon />}
        actions={
          <>
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Search announcements…"
              label="Search announcements by title, body, department or author"
            />
            {canManage && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
                New Announcement
              </Button>
            )}
          </>
        }
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

      {/* The reading measure applies to the body text, not to the card. These
          are notice cards — a title, a couple of chips, two or three lines —
          so capping the card would leave a 1400px page carrying an 820px
          column against 580px of nothing. The cards take the width they are
          given and hold their paragraphs to a readable line inside it. */}
      <Stack spacing={2}>
        {filtered.map((announcement) => (
          <Card key={announcement.id} variant="outlined">
            <CardContent>
              <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  {announcement.pinned && <PushPinIcon fontSize="small" color="primary" />}
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    {announcement.title}
                  </Typography>
                  {announcement.department_name && <Chip size="small" label={announcement.department_name} />}
                </Stack>
                {canManage && (
                  <Stack direction="row" spacing={0.5}>
                    <Tooltip title={showArchived ? "Put it back on the board" : "File it away"}>
                      <IconButton
                        size="small"
                        onClick={() =>
                          archive.mutate({ id: announcement.id, archived: showArchived })
                        }
                      >
                        {showArchived ? (
                          <UnarchiveIcon fontSize="small" />
                        ) : (
                          <ArchiveIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete permanently">
                      <IconButton size="small" onClick={() => deleteAnnouncement.mutate(announcement.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                )}
              </Stack>
              {/* The reading measure, on the thing that is actually prose. A
                  notice runs to a paragraph and a 1400px line is unreadable;
                  the card around it is free to use the page. */}
              <Typography variant="body2" sx={{ mt: 1, maxWidth: "72ch", whiteSpace: "pre-wrap" }}>
                {announcement.body}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
                {announcement.posted_by} · {new Date(announcement.created_at).toLocaleString()}
              </Typography>
            </CardContent>
          </Card>
        ))}
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

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>New announcement</DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Title" fullWidth value={title} onChange={(e) => setTitle(e.target.value)} />
            <TextField label="Body" fullWidth multiline minRows={3} value={body} onChange={(e) => setBody(e.target.value)} />
            {/* No department selected means company-wide, so the helper text
                has to say so — an empty picker is otherwise indistinguishable
                from one you forgot to fill in. */}
            <DepartmentPicker
              label="Audience"
              value={department === "" ? null : department}
              onChange={(id) => setDepartment(id ?? "")}
              helperText="Leave empty to post company-wide."
            />
            <FormControlLabel
              control={<Switch checked={pinned} onChange={(e) => setPinned(e.target.checked)} />}
              label="Pin to top"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={createAnnouncement.isPending}>
            Post
          </Button>
        </DialogActions>
      </Dialog>
    </PageContainer>
  );
}
