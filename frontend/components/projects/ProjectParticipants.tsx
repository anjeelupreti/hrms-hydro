"use client";

import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import LinearProgress from "@mui/material/LinearProgress";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import PersonAvatar from "@/components/common/PersonAvatar";
import type { ProjectTask } from "@/types/projects";

/**
 * Who is on this project, and what each of them is carrying.
 *
 * A row of faces answers "is anyone on this" at a glance — which the owner's
 * name alone does not, since the owner is frequently not the person doing the
 * work. Opening it answers the question that actually gets asked in a stand-up:
 * **who has too much, and who is stuck.**
 *
 * **Derived from the tasks, not from a membership list.** A project has no
 * roster model, and inventing one would create a second answer to "who is on
 * this" that drifts from the first the moment somebody is assigned work without
 * being added. Whoever holds a task is on the project; that cannot disagree
 * with itself.
 *
 * **Sorted by what is left, not by what is finished.** Somebody with nine open
 * tasks is the finding; somebody who has closed nine is context. The
 * unassigned pile sorts last and is deliberately shown rather than dropped —
 * work belonging to nobody is the most useful row on this list.
 */

type Member = {
  name: string | null;
  open: number;
  done: number;
  blocked: number;
};

export default function ProjectParticipants({ tasks }: { tasks: ProjectTask[] }) {
  const [open, setOpen] = useState(false);

  const byPerson = new Map<string, Member>();
  for (const task of tasks) {
    const key = task.assignee_name ?? "";
    const member = byPerson.get(key) ?? { name: task.assignee_name, open: 0, done: 0, blocked: 0 };
    if (task.status === "done") member.done += 1;
    else member.open += 1;
    if (task.status === "blocked") member.blocked += 1;
    byPerson.set(key, member);
  }

  const members = [...byPerson.values()].sort((a, b) => {
    // Unassigned last, whatever it is carrying — it is a pile, not a person.
    if (a.name === null) return 1;
    if (b.name === null) return -1;
    return b.open - a.open || b.done - a.done;
  });

  const people = members.filter((m) => m.name !== null);
  if (people.length === 0) return null;

  const shown = people.slice(0, 5);
  const more = people.length - shown.length;

  return (
    <>
      <Tooltip title="Who is on this project">
        <Box
          component="button"
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Who is on this project — ${people.length} people`}
          sx={{
            all: "unset",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            borderRadius: 999,
            p: 0.25,
            "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main" },
          }}
        >
          {shown.map((member, index) => (
            <Box
              key={member.name}
              sx={{
                // Overlapped, with a ring in the surface colour so the faces
                // read as a stack rather than as a smear.
                ml: index === 0 ? 0 : "-8px",
                borderRadius: "50%",
                border: "2px solid",
                borderColor: "background.paper",
                display: "inline-flex",
              }}
            >
              <PersonAvatar name={member.name ?? ""} size={26} />
            </Box>
          ))}
          {more > 0 && (
            <Typography
              variant="caption"
              sx={{ ml: 0.75, color: "text.secondary", fontVariantNumeric: "tabular-nums" }}
            >
              +{more}
            </Typography>
          )}
        </Box>
      </Tooltip>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Who is on this project</DialogTitle>
        <DialogContent>
          {members.map((member) => {
            const total = member.open + member.done;
            const pct = total === 0 ? 0 : (member.done / total) * 100;
            return (
              <Box
                key={member.name ?? "unassigned"}
                sx={{ display: "flex", gap: 1.5, alignItems: "center", py: 1.25 }}
              >
                {member.name ? (
                  <PersonAvatar name={member.name} size={32} />
                ) : (
                  <Box
                    aria-hidden
                    sx={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      border: "1px dashed",
                      borderColor: "divider",
                    }}
                  />
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    variant="body2"
                    noWrap
                    sx={{
                      fontWeight: 600,
                      color: member.name ? "text.primary" : "text.secondary",
                      fontStyle: member.name ? undefined : "italic",
                    }}
                  >
                    {member.name ?? "Nobody assigned"}
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    value={pct}
                    sx={{ height: 4, borderRadius: 2, mt: 0.5 }}
                  />
                </Box>
                <Box sx={{ textAlign: "right", flexShrink: 0 }}>
                  <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
                    {member.open} open
                  </Typography>
                  {member.blocked > 0 && (
                    <Typography variant="caption" sx={{ color: "error.main", fontWeight: 600 }}>
                      {member.blocked} blocked
                    </Typography>
                  )}
                </Box>
              </Box>
            );
          })}
        </DialogContent>
      </Dialog>
    </>
  );
}
