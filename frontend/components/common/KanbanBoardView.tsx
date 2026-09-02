"use client";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DragStart,
  type DropResult,
} from "@hello-pangea/dnd";
import { useMemo, useState, type ReactNode } from "react";

import { TOAST_ANCHOR, toastSx } from "@/components/common/GlobalToaster";

/**
 * One board, over any status field.
 *
 * **Generic, because five screens want the same interaction.** Deals, the
 * candidate pipeline, the client desk, the task board and the list-page view
 * switcher are one board over five different status fields. Hand-rolling each
 * gives five drag handlers to fix the same dropped-card bug in.
 *
 * **Columns are declared, never derived from the data.** An empty column is
 * information — *nothing is waiting on the customer* — and building columns from
 * the statuses present makes that vanish exactly when it is worth knowing. The
 * server sends the column set for the same reason.
 *
 * **Illegal moves are refused before the server is asked.** When `transitions`
 * is supplied, columns that cannot accept the dragged card dim while the drag
 * is in flight, and a drop there is rejected with a reason rather than the card
 * snapping back with no explanation. A card that springs home teaches nothing;
 * "resolved cannot be reached while waiting on the customer" teaches the rule.
 *
 * **Order within a column is a real answer.** Where the caller supplies
 * `onReorder`, a drag that starts and ends in the same column reports that
 * column's new order and it is kept. A board whose records have no order to
 * keep does not pass the callback, and a same-column drop leaves the card where
 * it was — which is the truth for those boards rather than a
 * silently dropped instruction.
 *
 * **The board shows the result before the server confirms it.** A card that
 * sits still for the length of a round-trip and then jumps reads as lag; one
 * that lands where it was dropped and quietly corrects itself if the server
 * disagrees reads as direct manipulation. The optimistic order is dropped as
 * soon as fresh columns arrive from the caller.
 */

export type KanbanColumn<T> = {
  value: string;
  label: string;
  cards: T[];
  /** Serve it rather than counting `cards.length` — a paginated column shows
   *  ten cards and may hold four hundred, and the count is the honest number. */
  count?: number;
  is_terminal?: boolean;
};

export type KanbanBoardProps<T> = {
  columns: KanbanColumn<T>[];
  /** Stable identity for a card. */
  getId: (card: T) => string | number;
  renderCard: (card: T) => ReactNode;
  /**
   * Legal destinations per status, as the server declares them. Omit and every
   * move is allowed — correct for a board with no flow, wrong to invent.
   */
  transitions?: Record<string, string[]>;
  /**
   * A card changed column. `index` is where in the destination it was dropped,
   * for a board that also keeps an order.
   */
  onMove: (card: T, to: string, index: number) => void | Promise<void>;
  /**
   * A column was re-ordered, given every card in it in its new order.
   *
   * The whole column, not "move this card to index 3": a position only means
   * anything relative to its neighbours, and two people dragging at once with
   * index instructions produce an order neither asked for. Omit it on a board
   * whose records have no order to keep, and a same-column drop simply leaves
   * the card where it was.
   */
  onReorder?: (column: string, cards: T[]) => void | Promise<void>;
  /** Shown in a column with nothing in it. */
  emptyHint?: string;
  columnWidth?: number;
  minHeight?: number;
  /** Cards cannot be dragged — a read-only board still reads as a board. */
  readOnly?: boolean;
};

export default function KanbanBoard<T>({
  columns,
  getId,
  renderCard,
  transitions,
  onMove,
  onReorder,
  emptyHint = "Nothing here",
  columnWidth = 288,
  minHeight = 420,
  readOnly = false,
}: KanbanBoardProps<T>) {
  // Which column the in-flight card came from. Held so the other columns can
  // show whether they would accept it *while the drag is happening*, which is
  // the only moment that guidance is useful.
  const [draggingFrom, setDraggingFrom] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  // What the board looks like after the drop, before the server has agreed.
  // Keyed by column so only the column that moved is overridden.
  const [optimistic, setOptimistic] = useState<Record<string, T[]> | null>(null);

  // Fresh columns from the caller always win: once the query has refetched, the
  // server's answer is the truth and the local guess has served its purpose.
  //
  // Keyed on the *contents*, not the array. Callers build `columns` inline, so
  // its identity changes on every render — depending on that would clear the
  // optimistic state before the drop had finished painting, and set state on
  // every render besides.
  const signature = useMemo(
    () => columns.map((column) => `${column.value}:${column.cards.map(getId).join(",")}`).join("|"),
    // `getId` is a prop and callers pass an inline arrow, so it is deliberately
    // not a dependency: it is pure, and including it would defeat the memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns],
  );
  // Adjusted during render rather than in an effect. An effect would paint the
  // stale optimistic board once, then correct it — a visible flicker on every
  // refetch — and React has a name for this: resetting state when a prop
  // changes. The extra render happens before anything reaches the screen.
  const [lastSignature, setLastSignature] = useState(signature);
  if (signature !== lastSignature) {
    setLastSignature(signature);
    setOptimistic(null);
  }

  const shown = optimistic
    ? columns.map((column) =>
        optimistic[column.value] ? { ...column, cards: optimistic[column.value] } : column,
      )
    : columns;

  const allColumns = new Map(shown.map((column) => [column.value, column]));

  function allowed(from: string | null, to: string) {
    if (!transitions || from === null) return true;
    if (from === to) return true;
    return (transitions[from] ?? []).includes(to);
  }

  function handleDragStart(start: DragStart) {
    setDraggingFrom(start.source.droppableId);
  }

  async function handleDragEnd(result: DropResult) {
    setDraggingFrom(null);
    const { destination, source, draggableId } = result;
    if (!destination) return;

    const to = destination.droppableId;
    const from = source.droppableId;
    // Dropped back exactly where it was picked up. Not a change, and reporting
    // it would write an identical order on every accidental nudge.
    if (to === from && destination.index === source.index) return;

    const card = shown
      .flatMap((column) => column.cards)
      .find((candidate) => String(getId(candidate)) === draggableId);
    if (!card) return;

    if (!allowed(from, to)) {
      // Say what the rule is, not that a rule exists.
      const fromLabel = allColumns.get(from)?.label ?? from;
      const toLabel = allColumns.get(to)?.label ?? to;
      setRefusal(`${toLabel} cannot be reached from ${fromLabel}.`);
      return;
    }

    const sourceCards = [...(allColumns.get(from)?.cards ?? [])];
    const [lifted] = sourceCards.splice(source.index, 1);
    if (!lifted) return;

    if (to === from) {
      if (!onReorder) return;
      sourceCards.splice(destination.index, 0, lifted);
      setOptimistic({ [from]: sourceCards });
      await onReorder(from, sourceCards);
      return;
    }

    const destinationCards = [...(allColumns.get(to)?.cards ?? [])];
    destinationCards.splice(destination.index, 0, lifted);
    setOptimistic({ [from]: sourceCards, [to]: destinationCards });
    await onMove(card, to, destination.index);
    // A cross-column drop that also lands at a chosen position is two facts:
    // the new column, and where in it. The status change is the caller's to
    // save; the order is reported separately so a board without one can ignore
    // it entirely.
    if (onReorder) await onReorder(to, destinationCards);
  }

  return (
    <>
      <DragDropContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <Box sx={{ display: "flex", gap: 2, overflowX: "auto", pb: 2, alignItems: "flex-start" }}>
          {shown.map((column) => {
            const droppable = allowed(draggingFrom, column.value);
            const isSource = draggingFrom === column.value;

            return (
              <Box key={column.value} sx={{ minWidth: columnWidth, flex: `0 0 ${columnWidth}px` }}>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ mb: 1, alignItems: "center", px: 0.5 }}
                >
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }} noWrap>
                    {column.label}
                  </Typography>
                  <Chip
                    size="small"
                    label={column.count ?? column.cards.length}
                  />
                  {column.is_terminal && (
                    <Typography variant="caption" color="text.secondary">
                      final
                    </Typography>
                  )}
                </Stack>

                <Droppable droppableId={column.value} isDropDisabled={readOnly || !droppable}>
                  {(provided, snapshot) => (
                    <Box
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      sx={{
                        minHeight,
                        borderRadius: 3,
                        p: 1,
                        transition: "background-color 120ms, opacity 120ms",
                        bgcolor: snapshot.isDraggingOver ? "action.hover" : "background.default",
                        // Dimmed only while a drag is actually in flight, and
                        // never the column the card came from — a card must
                        // always be returnable to where it started.
                        opacity: draggingFrom && !droppable && !isSource ? 0.4 : 1,
                        outline: snapshot.isDraggingOver ? "2px dashed" : "none",
                        outlineColor: "primary.main",
                      }}
                    >
                      {column.cards.length === 0 && !snapshot.isDraggingOver && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: "block", textAlign: "center", pt: 3 }}
                        >
                          {emptyHint}
                        </Typography>
                      )}

                      {column.cards.map((card, index) => (
                        <Draggable
                          key={String(getId(card))}
                          draggableId={String(getId(card))}
                          index={index}
                          isDragDisabled={readOnly}
                        >
                          {(dragProvided, dragSnapshot) => (
                            <Box
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              {...dragProvided.dragHandleProps}
                              sx={{
                                mb: 1,
                                // A lifted card, so the thing being moved is
                                // obvious against a board of similar cards.
                                boxShadow: dragSnapshot.isDragging ? 8 : 0,
                                borderRadius: 2,
                                cursor: readOnly ? "default" : "grab",
                                "&:active": { cursor: readOnly ? "default" : "grabbing" },
                              }}
                            >
                              {renderCard(card)}
                            </Box>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </Box>
                  )}
                </Droppable>

                {/* Named while dragging, so somebody knows the column is dim on
                    purpose rather than broken. */}
                {draggingFrom && !droppable && !isSource && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", textAlign: "center", mt: 0.5 }}
                  >
                    not reachable from here
                  </Typography>
                )}
              </Box>
            );
          })}
        </Box>
      </DragDropContext>

      <Snackbar
        open={Boolean(refusal)}
        autoHideDuration={4000}
        onClose={() => setRefusal(null)}
        anchorOrigin={TOAST_ANCHOR}
        sx={toastSx}
      >
        <Alert severity="warning" onClose={() => setRefusal(null)}>
          {refusal}
        </Alert>
      </Snackbar>
    </>
  );
}
