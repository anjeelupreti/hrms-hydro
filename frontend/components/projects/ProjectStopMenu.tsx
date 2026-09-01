"use client";

/**
 * Stopping and restarting a project.
 *
 * **There is no delete here, and there is none on the server either.** A
 * project owns approved timesheets and every task's history, so deleting one
 * would erase the record of work people were already paid for. The removal path
 * is a state change, which is what R2 asks for where a hard delete would
 * destroy history.
 *
 * Two ways to stop, kept separate because the reason is the useful part:
 * **on hold** says the work is expected to resume, **cancelled** says it is
 * not. A stopped project is always asked "why did this stop?", and one status
 * covering both cannot answer.
 *
 * Cancelling asks for confirmation and putting on hold does not — not because
 * cancelling is irreversible (nothing here is) but because it is the one that
 * reads as final to everybody else looking at the board.
 */

import MoreVertIcon from "@mui/icons-material/MoreHoriz";
import PauseCircleIcon from "@mui/icons-material/PauseCircle";
import PlayCircleIcon from "@mui/icons-material/PlayCircle";
import BlockIcon from "@mui/icons-material/Block";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import { useState } from "react";

import { useSetProjectStatus } from "@/hooks/useProjects";
import type { Project, ProjectStatus } from "@/types/projects";

const STOPPED: ProjectStatus[] = ["on_hold", "cancelled"];

export default function ProjectStopMenu({
  project,
  onError,
}: {
  project: Project;
  onError: (message: string) => void;
}) {
  const setStatus = useSetProjectStatus();
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const isStopped = STOPPED.includes(project.status);

  async function apply(status: ProjectStatus) {
    setAnchor(null);
    setConfirmCancel(false);
    onError("");
    try {
      await setStatus.mutateAsync({ id: project.id, status });
    } catch (err) {
      onError(err instanceof Error ? err.message : "That could not be saved.");
    }
  }

  return (
    <>
      <Tooltip title="Project status">
        <IconButton
          onClick={(e) => setAnchor(e.currentTarget)}
          disabled={setStatus.isPending}
          aria-label="Change project status"
        >
          <MoreVertIcon />
        </IconButton>
      </Tooltip>

      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {isStopped ? (
          <MenuItem onClick={() => apply("active")}>
            <ListItemIcon>
              <PlayCircleIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary="Reopen project"
              secondary={
                project.status === "cancelled"
                  ? "Puts it back to active. Nothing was lost."
                  : "Puts it back to active."
              }
            />
          </MenuItem>
        ) : null}

        {project.status !== "on_hold" ? (
          <MenuItem onClick={() => apply("on_hold")}>
            <ListItemIcon>
              <PauseCircleIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Put on hold" secondary="Paused, and expected to resume." />
          </MenuItem>
        ) : null}

        {project.status !== "cancelled" ? (
          <MenuItem onClick={() => setConfirmCancel(true)}>
            <ListItemIcon>
              <BlockIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Cancel project" secondary="Stopped, and not expected to resume." />
          </MenuItem>
        ) : null}
      </Menu>

      <Dialog open={confirmCancel} onClose={() => setConfirmCancel(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Cancel {project.name}?</DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            The project stops and drops off the active boards.
            {/* Said plainly, because "cancel" reads as "delete" to most people
                and the difference is the whole point of this dialog. */}
            <p style={{ margin: "12px 0 0" }}>
              <strong>Nothing is deleted.</strong> Its {project.task_count}{" "}
              {project.task_count === 1 ? "task" : "tasks"}, every comment, the logged hours and the
              full history all stay, and you can reopen it at any time.
            </p>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmCancel(false)}>Keep it open</Button>
          <Button color="error" variant="contained" onClick={() => apply("cancelled")}>
            Cancel project
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
