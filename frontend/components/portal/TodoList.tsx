"use client";

import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";

import CardEmpty from "@/components/dashboard/CardEmpty";

import { compactCard } from "@/lib/theme/cards";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import UnarchiveOutlinedIcon from "@mui/icons-material/UnarchiveOutlined";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Checkbox from "@mui/material/Checkbox";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import {
  useArchiveTodo,
  useCreateTodo,
  useDeleteTodo,
  useRestoreTodo,
  useTodos,
  useToggleTodo,
  useUpdateTodo,
  type Todo,
} from "@/hooks/useTodos";

/**
 * A private list, on the page that is supposed to be yours.
 *
 * **Not a task board, and it takes some care to keep it that way.** The
 * temptation is to grow this into assignees and statuses until it duplicates
 * `/projects`. It stays a list of lines you can tick, because the thing it
 * competes with is a paper pad, and a paper pad wins on the two features that
 * matter: writing on it takes one gesture, and nobody else reads it.
 *
 * **One gesture to add.** The input is always there, always in the same place,
 * and Enter commits. Hiding "new to-do" behind a button and a dialog is three
 * interactions for a line of text, and a list that costs three interactions to
 * add to is a list nobody keeps up to date — at which point it lies.
 *
 * **Editing happens in place.** The title is the input; blur or Enter saves.
 * A modal to change four words is the same tax in a different coat.
 *
 * **Archive is offered first and delete second**, because on a personal list
 * the common case is "done with this, get it off my screen" rather than "this
 * never existed" — and only one of those is reversible.
 */

function DueLabel({ value }: { value: string | null }) {
  if (!value) return null;
  const due = new Date(`${value}T23:59:59`);
  const overdue = due < new Date();
  return (
    <Typography
      variant="caption"
      sx={{ flexShrink: 0, color: overdue ? "var(--hrms-status-danger-fg)" : "text.secondary" }}
    >
      {value}
    </Typography>
  );
}

function Row({ todo, archived }: { todo: Todo; archived: boolean }) {
  const toggle = useToggleTodo();
  const update = useUpdateTodo();
  const archive = useArchiveTodo();
  const restore = useRestoreTodo();
  const remove = useDeleteTodo();

  const [title, setTitle] = useState(todo.title);

  function commit() {
    const next = title.trim();
    // An empty box is a slip, not an instruction to blank the row — put the
    // old title back rather than saving nothing.
    if (!next) {
      setTitle(todo.title);
      return;
    }
    if (next !== todo.title) update.mutate({ id: todo.id, title: next });
  }

  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        alignItems: "center",
        borderRadius: 1.5,
        px: 0.5,
        "&:hover .todo-actions": { opacity: 1 },
      }}
    >
      <Checkbox
        size="small"
        checked={todo.is_done}
        onChange={() => toggle.mutate(todo.id)}
        sx={{ p: 0.5 }}
        slotProps={{
          input: { "aria-label": `Mark "${todo.title}" ${todo.is_done ? "not done" : "done"}` },
        }}
      />

      <InputBase
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          if (event.key === "Escape") setTitle(todo.title);
        }}
        sx={{
          flexGrow: 1,
          fontSize: 14,
          // A ticked item stays readable rather than greyed into illegibility:
          // the list is also a record of what got done today.
          textDecoration: todo.is_done ? "line-through" : "none",
          color: todo.is_done ? "text.secondary" : "text.primary",
        }}
      />

      <DueLabel value={todo.due_date} />

      <Stack
        direction="row"
        className="todo-actions"
        sx={{ opacity: 0, transition: "opacity .15s", flexShrink: 0 }}
      >
        {archived ? (
          <Tooltip title="Put back on the list">
            <IconButton size="small" onClick={() => restore.mutate(todo.id)}>
              <UnarchiveOutlinedIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </Tooltip>
        ) : (
          <Tooltip title="Archive">
            <IconButton size="small" onClick={() => archive.mutate(todo.id)}>
              <ArchiveOutlinedIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="Delete for good">
          <IconButton size="small" onClick={() => remove.mutate(todo.id)}>
            <DeleteOutlineIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
      </Stack>
    </Stack>
  );
}

export default function TodoList() {
  const [showArchived, setShowArchived] = useState(false);
  const { data: todos, isLoading } = useTodos(showArchived);
  const create = useCreateTodo();
  const [draft, setDraft] = useState("");

  function add() {
    const title = draft.trim();
    if (!title) return;
    create.mutate({ title });
    setDraft("");
  }

  const rows = todos ?? [];
  const open = rows.filter((t) => !t.is_done).length;

  return (
    <Card sx={compactCard}>
      <CardContent>
        <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between" }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            My to-do list
          </Typography>
          <Button size="small" onClick={() => setShowArchived((v) => !v)} sx={{ minWidth: 0 }}>
            {showArchived ? "Back to list" : "Archive"}
          </Button>
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          {showArchived
            ? "Archived items. Nothing here counts towards your list."
            : "Private to you — nobody else in the system can see this."}
        </Typography>

        {showArchived ? null : (
          <Stack
            direction="row"
            spacing={1}
            sx={{
              alignItems: "center",
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 1.5,
              px: 1.25,
              py: 0.5,
              mb: 1,
            }}
          >
            <InputBase
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") add();
              }}
              placeholder="Write something down…"
              sx={{ flexGrow: 1, fontSize: 14 }}
              inputProps={{ "aria-label": "New to-do" }}
            />
            <Button size="small" onClick={add} disabled={!draft.trim()}>
              Add
            </Button>
          </Stack>
        )}

        {isLoading ? (
          <Skeleton variant="rounded" height={120} />
        ) : rows.length === 0 ? (
          <CardEmpty>{showArchived ? "Nothing archived yet." : "Nothing on your list."}</CardEmpty>
        ) : (
          <Stack spacing={0.25}>
            {rows.map((todo) => (
              <Row key={todo.id} todo={todo} archived={showArchived} />
            ))}
          </Stack>
        )}

        {!showArchived && rows.length > 0 ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
            {open === 0 ? "All done." : `${open} of ${rows.length} still open.`}
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  );
}
