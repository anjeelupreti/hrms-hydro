"use client";

import ArrowForwardIcon from "@mui/icons-material/ArrowForward";

import { analyticsCard } from "@/lib/theme/cards";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

/**
 * The work that is actually mine, on the page that claims to be my workspace.
 *
 * What somebody is present *for*, from `ProjectTaskViewSet.mine`. Without it My
 * workspace is punches, a small month and some counters — a record of being
 * present with no trace of the work.
 *
 * **Grouped by project, not listed flat.** Eleven tasks in one column is a list
 * to work through; the same eleven under three project headings is a picture of
 * where the week is going, and it takes no more space.
 *
 * **Blocked sorts first, then overdue, then the rest.** Blocked is the only
 * state on a board that nobody clears by working harder, so it is the one worth
 * raising — the same reasoning the portfolio summary uses.
 */

type MineTask = {
  id: number;
  title: string;
  status: string;
  project: number;
  project_name?: string | null;
  due_date?: string | null;
  priority?: string | null;
};

function useMyTasks() {
  return useQuery({
    queryKey: ["tasks", "mine"],
    queryFn: async () => {
      const res = await fetch("/api/proxy/projects/tasks/mine?page_size=50");
      if (!res.ok) throw new Error("Could not load your tasks");
      const data = await res.json();
      // The endpoint paginates when there are enough rows and returns a bare
      // array when there are not — handle both rather than assuming.
      return (Array.isArray(data) ? data : (data.results ?? [])) as MineTask[];
    },
  });
}

const RANK: Record<string, number> = { blocked: 0, in_review: 1, in_progress: 2, todo: 3 };

function isOverdue(task: MineTask) {
  if (!task.due_date) return false;
  return new Date(`${task.due_date}T23:59:59`) < new Date();
}

export default function AssignedToMe() {
  const { data: tasks, isLoading } = useMyTasks();

  if (isLoading) return <Skeleton variant="rounded" height={220} />;

  const rows = [...(tasks ?? [])].sort((a, b) => {
    const overdue = Number(isOverdue(b)) - Number(isOverdue(a));
    if (overdue) return overdue;
    return (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9);
  });

  const byProject = new Map<string, MineTask[]>();
  rows.forEach((task) => {
    const key = task.project_name ?? "Unassigned project";
    byProject.set(key, [...(byProject.get(key) ?? []), task]);
  });

  const overdueCount = rows.filter(isOverdue).length;
  const blocked = rows.filter((t) => t.status === "blocked").length;

  return (
    // `analyticsCard` carries `height: 100%`, which is right beside a taller
    // stack and wrong when there is nothing to show — one sentence stretched to
    // 450px. Full width, it takes the height its content asks for.
    <Card sx={rows.length === 0 ? undefined : analyticsCard}>
      <CardContent>
        <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between", mb: 0.25 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Assigned to me
          </Typography>
          <Box
            component={Link}
            href="/projects"
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0.5,
              fontSize: 13,
              fontWeight: 650,
              color: "primary.main",
              textDecoration: "none",
            }}
          >
            All work <ArrowForwardIcon sx={{ fontSize: 15 }} />
          </Box>
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
          {rows.length === 0
            ? "Nothing is assigned to you."
            : blocked
              ? `${rows.length} open · ${blocked} blocked — those need somebody else to move first.`
              : overdueCount
                ? `${rows.length} open · ${overdueCount} past their date.`
                : `${rows.length} open, none overdue.`}
        </Typography>

        {rows.length === 0 ? null : (
          <Stack spacing={2}>
            {[...byProject.entries()].map(([project, items]) => (
              <Box key={project}>
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 700, color: "text.secondary", letterSpacing: ".04em" }}
                >
                  {project.toUpperCase()}
                </Typography>
                <Stack spacing={0.5} sx={{ mt: 0.75 }}>
                  {items.map((task) => (
                    <Stack
                      key={task.id}
                      component={Link}
                      href={`/projects/${task.project}`}
                      direction="row"
                      spacing={1}
                      sx={{
                        alignItems: "center",
                        textDecoration: "none",
                        color: "inherit",
                        px: 1,
                        py: 0.75,
                        borderRadius: 1.5,
                        "&:hover": { bgcolor: "action.hover" },
                      }}
                    >
                      <Box
                        sx={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          flexShrink: 0,
                          // Blocked is the only one that gets a status colour:
                          // it is the only state the assignee cannot clear.
                          bgcolor:
                            task.status === "blocked" ? "var(--hrms-status-danger-solid)" : "text.disabled",
                        }}
                      />
                      <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>
                        {task.title}
                      </Typography>
                      {isOverdue(task) ? (
                        <Chip
                          size="small"
                          label={task.due_date}
                          color="warning"
                          variant="outlined"
                          sx={{ height: 20, fontSize: 11 }}
                        />
                      ) : task.due_date ? (
                        <Typography variant="caption" color="text.secondary">
                          {task.due_date}
                        </Typography>
                      ) : null}
                    </Stack>
                  ))}
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
