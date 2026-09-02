"use client";

import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import dynamic from "next/dynamic";

import type { KanbanBoardProps } from "@/components/common/KanbanBoardView";

export type { KanbanColumn, KanbanBoardProps } from "@/components/common/KanbanBoardView";

/**
 * The board, loaded only when a board is actually shown.
 *
 * **Why this file exists at all.** `@hello-pangea/dnd` is the largest thing in
 * the app after the data grid, and every one of the five screens that use a
 * board keeps it behind a view switch or a tab: deals open as a list, tickets
 * open as a list, the project page opens on its first tab, the candidate
 * pipeline sits behind a tab. The component was already *rendered*
 * conditionally — and *imported* unconditionally, so the drag-and-drop engine
 * shipped in the first load of five pages whether or not anybody ever pressed
 * the board button.
 *
 * Splitting it here rather than at each call site means the four importers did
 * not have to change and cannot forget: `import KanbanBoard from
 * ".../KanbanBoard"` still means what it meant, and the split is a property of
 * the board rather than of who is using it.
 *
 * `ssr: false` because a drag context has nothing to say on the server — it
 * renders a static board that is replaced on hydration. Skipping it removes
 * that duplicated work and the flash it causes.
 *
 * The fallback is column-shaped rather than a spinner. This mounts when
 * somebody clicks "board", and a spinner where a board is about to be reads as
 * *loading your cards*; three empty columns read as *the board is arriving*,
 * which is what is happening.
 */
const KanbanBoardView = dynamic(() => import("@/components/common/KanbanBoardView"), {
  ssr: false,
  loading: () => (
    <Stack direction="row" spacing={2} sx={{ overflowX: "auto", pb: 1 }}>
      {Array.from({ length: 3 }).map((_, column) => (
        <Stack key={column} spacing={1.5} sx={{ minWidth: 280 }}>
          <Skeleton variant="rounded" height={32} />
          <Skeleton variant="rounded" height={96} />
          <Skeleton variant="rounded" height={96} />
        </Stack>
      ))}
    </Stack>
  ),
});

/**
 * `dynamic` erases the implementation's generic parameter — it types the result
 * as a component over the props it was given, and `<T>` is not knowable at the
 * import boundary. Re-declaring the signature here restores it, so call sites
 * keep inferring `T` from their own `columns` exactly as before. The cast is
 * confined to this line; nothing downstream sees it.
 */
export default KanbanBoardView as <T>(props: KanbanBoardProps<T>) => React.JSX.Element;
