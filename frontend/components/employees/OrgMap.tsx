"use client";

import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useCallback, useMemo, useRef, useState } from "react";

/**
 * The reporting hierarchy as a map you can move around in.
 *
 * An org chart's whole job is to make the *shape* of a company visible, which
 * rules out an indented list: at three levels it reads as a bulleted outline,
 * and at five the indent runs off the right of the page with a person's manager
 * several screens of scrolling above them.
 *
 * **Laid out, not flowed.** Positions are computed with a tidy-tree pass —
 * leaves take the next free slot, every parent is centred over its children —
 * so siblings line up and a branch's width is the width of what it contains.
 * That is what makes a wide team look wide and a deep chain look deep, which is
 * the information somebody opens this page for.
 *
 * **Both orientations, because they answer different questions.** Top-to-bottom
 * is the conventional shape and reads as hierarchy. Left-to-right fits a deep
 * chain on a laptop screen — a nine-level company is unreadable vertically and
 * fine horizontally.
 *
 * **Pan and zoom rather than a scrollbar.** A chart wider than the viewport is
 * normal, not an edge case, and dragging is how people already expect to move
 * around a map.
 *
 * **Rank comes from the post, not the depth.** `Designation.rank` is a property
 * of the job; tree depth is a property of who happens to sign things off. Two
 * peers on different branches sit at different depths and are still peers, so
 * the rank is shown on the card rather than inferred from where the card
 * landed.
 */

export type OrgNode = {
  id: number;
  name: string;
  employee_code: string;
  designation: string | null;
  rank: number;
  department: string | null;
  department_id: number | null;
  photo: string | null;
  manager: number | null;
  children: OrgNode[];
};

export type OrgDepartment = {
  id: number | null;
  name: string;
  people: Omit<OrgNode, "children">[];
};

/* ── Layout ──────────────────────────────────────────────────────────── */

const CARD_W = 208;
const CARD_H = 78;
const GAP_X = 28;
const GAP_Y = 58;

type Placed = { node: OrgNode; x: number; y: number };

/**
 * Tidy tree, in one post-order pass.
 *
 * Leaves consume the next horizontal slot; a parent centres over the span of
 * its children. This is the minimal version of Reingold–Tilford — it does not
 * do the sibling-subtree compaction, which matters on charts far larger than an
 * org and would cost more than it buys here.
 */
function layout(roots: OrgNode[]): { placed: Placed[]; width: number; height: number } {
  const placed: Placed[] = [];
  let cursor = 0;
  let deepest = 0;

  const walk = (node: OrgNode, depth: number): number => {
    deepest = Math.max(deepest, depth);
    if (!node.children.length) {
      const x = cursor;
      cursor += 1;
      placed.push({ node, x, y: depth });
      return x;
    }
    const childCentres = node.children.map((child) => walk(child, depth + 1));
    const x = (childCentres[0] + childCentres[childCentres.length - 1]) / 2;
    placed.push({ node, x, y: depth });
    return x;
  };

  roots.forEach((root) => {
    walk(root, 0);
    // A gap between roots, so two separate hierarchies do not read as one.
    cursor += 1;
  });

  return { placed, width: Math.max(cursor, 1), height: deepest + 1 };
}

function positionOf(p: Placed, vertical: boolean) {
  return vertical
    ? { left: p.x * (CARD_W + GAP_X), top: p.y * (CARD_H + GAP_Y) }
    : { left: p.y * (CARD_W + GAP_X + 40), top: p.x * (CARD_H + GAP_X) };
}

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((s) => s[0]?.toUpperCase() ?? "").join("");
}

/* ── Card ────────────────────────────────────────────────────────────── */

function PersonCard({
  node,
  onOpen,
  dim,
}: {
  node: OrgNode;
  onOpen?: (id: number) => void;
  dim?: boolean;
}) {
  return (
    <Box
      component="button"
      onClick={() => onOpen?.(node.id)}
      sx={{
        width: CARD_W,
        height: CARD_H,
        textAlign: "left",
        font: "inherit",
        cursor: onOpen ? "pointer" : "default",
        display: "flex",
        alignItems: "center",
        gap: 1.25,
        px: 1.5,
        borderRadius: 2,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
        opacity: dim ? 0.35 : 1,
        transition: "opacity .2s, border-color .2s, box-shadow .2s",
        "&:hover": { borderColor: "primary.main", boxShadow: 2 },
      }}
    >
      <Avatar src={node.photo ?? undefined} sx={{ width: 38, height: 38, fontSize: 14, flexShrink: 0 }}>
        {initials(node.name)}
      </Avatar>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.25 }} noWrap>
          {node.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
          {node.designation ?? "—"}
        </Typography>
        <Typography variant="caption" color="text.disabled" noWrap sx={{ display: "block" }}>
          {node.department ?? "Unassigned"}
        </Typography>
      </Box>
      {/* Rank 0 is unranked and shows nothing — a "0" badge would read as a
          seniority, which is the one thing it is not. */}
      {node.rank ? (
        <Tooltip title={`Rank ${node.rank} — 1 is most senior`}>
          <Box
            sx={{
              flexShrink: 0,
              width: 22,
              height: 22,
              borderRadius: "6px",
              display: "grid",
              placeItems: "center",
              bgcolor: "action.hover",
              fontSize: 11,
              fontWeight: 700,
              color: "text.secondary",
            }}
          >
            {node.rank}
          </Box>
        </Tooltip>
      ) : null}
    </Box>
  );
}

/* ── The map ─────────────────────────────────────────────────────────── */

export default function OrgMap({
  roots,
  vertical = true,
  query = "",
  onOpen,
}: {
  roots: OrgNode[];
  vertical?: boolean;
  query?: string;
  onOpen?: (id: number) => void;
}) {
  const { placed, width, height } = useMemo(() => layout(roots), [roots]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 24, y: 24 });
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  /**
   * Whether a drag is in progress, as state rather than read off the ref.
   *
   * The cursor depends on it, and a ref does not trigger a re-render — so
   * `cursor: drag.current ? ...` would have painted whatever the value happened
   * to be at the last unrelated render, which is usually the wrong one. The ref
   * keeps the drag *origin* (changes constantly, must not re-render); the flag
   * is state because something visible depends on it.
   */
  const [dragging, setDragging] = useState(false);

  const canvas = vertical
    ? { w: width * (CARD_W + GAP_X) + 80, h: height * (CARD_H + GAP_Y) + 80 }
    : { w: height * (CARD_W + GAP_X + 40) + 80, h: width * (CARD_H + GAP_X) + 80 };

  const byId = useMemo(() => new Map(placed.map((p) => [p.node.id, p])), [placed]);

  const matches = useCallback(
    (node: OrgNode) => {
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        node.name.toLowerCase().includes(q) ||
        (node.designation ?? "").toLowerCase().includes(q) ||
        (node.department ?? "").toLowerCase().includes(q) ||
        node.employee_code.toLowerCase().includes(q)
      );
    },
    [query],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    // Only a drag on the background — a drag that starts on a card would make
    // the cards unclickable.
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setPan({
      x: drag.current.panX + (e.clientX - drag.current.x),
      y: drag.current.panY + (e.clientY - drag.current.y),
    });
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  return (
    <Box sx={{ position: "relative" }}>
      {/* Zoom, as buttons rather than only a wheel gesture: a wheel over a
          scrollable page is ambiguous, and a trackpad user has no other way. */}
      <Stack
        direction="row"
        spacing={0.5}
        sx={{
          position: "absolute",
          right: 12,
          top: 12,
          zIndex: 2,
          bgcolor: "background.paper",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 2,
          p: 0.5,
        }}
      >
        {[
          { label: "−", act: () => setZoom((z) => Math.max(0.4, z - 0.15)) },
          { label: "Reset", act: () => { setZoom(1); setPan({ x: 24, y: 24 }); } },
          { label: "+", act: () => setZoom((z) => Math.min(1.6, z + 0.15)) },
        ].map((b) => (
          <Box
            key={b.label}
            component="button"
            onClick={b.act}
            sx={{
              font: "inherit",
              fontSize: 13,
              px: 1.25,
              py: 0.4,
              border: "none",
              borderRadius: 1.5,
              cursor: "pointer",
              bgcolor: "transparent",
              "&:hover": { bgcolor: "action.hover" },
            }}
          >
            {b.label}
          </Box>
        ))}
      </Stack>

      <Box
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        sx={{
          position: "relative",
          height: { xs: 460, md: 620 },
          overflow: "hidden",
          borderRadius: 2,
          border: "1px solid",
          borderColor: "divider",
          bgcolor: "background.default",
          cursor: dragging ? "grabbing" : "grab",
          touchAction: "none",
          // A faint grid, so panning has something to move against. Without it
          // a drag on empty space looks like nothing happened.
          backgroundImage: (t) =>
            `radial-gradient(circle, ${t.palette.divider} 1px, transparent 1px)`,
          backgroundSize: "22px 22px",
        }}
      >
        <Box
          sx={{
            position: "absolute",
            transformOrigin: "0 0",
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            width: canvas.w,
            height: canvas.h,
          }}
        >
          {/* Connectors first, so cards sit on top of them. Elbows rather than
              straight lines: a diagonal between two cards crosses its
              neighbours the moment a branch is wide. */}
          <Box
            component="svg"
            width={canvas.w}
            height={canvas.h}
            sx={{ position: "absolute", inset: 0, pointerEvents: "none" }}
          >
            {placed.map((p) =>
              p.node.children.map((child) => {
                const c = byId.get(child.id);
                if (!c) return null;
                const a = positionOf(p, vertical);
                const b = positionOf(c, vertical);
                const path = vertical
                  ? `M ${a.left + CARD_W / 2} ${a.top + CARD_H}
                     V ${a.top + CARD_H + GAP_Y / 2}
                     H ${b.left + CARD_W / 2}
                     V ${b.top}`
                  : `M ${a.left + CARD_W} ${a.top + CARD_H / 2}
                     H ${a.left + CARD_W + GAP_X}
                     V ${b.top + CARD_H / 2}
                     H ${b.left}`;
                return (
                  <path
                    key={`${p.node.id}-${child.id}`}
                    d={path}
                    fill="none"
                    stroke="currentColor"
                    strokeOpacity={0.28}
                    strokeWidth={1.5}
                  />
                );
              }),
            )}
          </Box>

          {placed.map((p) => {
            const pos = positionOf(p, vertical);
            return (
              <Box key={p.node.id} sx={{ position: "absolute", left: pos.left, top: pos.top }}>
                <PersonCard node={p.node} onOpen={onOpen} dim={!matches(p.node)} />
              </Box>
            );
          })}
        </Box>
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
        Drag to move · {placed.length} people ·{" "}
        {vertical ? "top to bottom" : "left to right"}
      </Typography>
    </Box>
  );
}

/* ── Department view ─────────────────────────────────────────────────── */

/**
 * The same people, grouped by the department they belong to.
 *
 * **Why this is not the tree with different colours.** Reporting lines cross
 * departments constantly — a finance manager reporting to a COO sits under
 * Operations in the hierarchy — so "show me Finance" cannot be answered by
 * highlighting a subtree. It is a different projection of the same data, and
 * the server sends both from one query.
 *
 * Ordered by seniority inside each department, because "who is senior in
 * Finance" is the question this view exists to answer and the tree answers it
 * badly.
 */
export function DepartmentMap({
  departments,
  query = "",
  onOpen,
}: {
  departments: OrgDepartment[];
  query?: string;
  onOpen?: (id: number) => void;
}) {
  const q = query.trim().toLowerCase();

  return (
    <Box
      sx={{
        display: "grid",
        gap: 2,
        gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)", xl: "repeat(3, 1fr)" },
      }}
    >
      {departments.map((dept) => {
        const people = dept.people.filter(
          (p) =>
            !q ||
            p.name.toLowerCase().includes(q) ||
            (p.designation ?? "").toLowerCase().includes(q) ||
            p.employee_code.toLowerCase().includes(q),
        );
        return (
          <Box
            key={dept.id ?? "unassigned"}
            sx={{
              p: 2,
              borderRadius: 2,
              border: "1px solid",
              borderColor: "divider",
              bgcolor: "background.paper",
              opacity: q && !people.length ? 0.4 : 1,
            }}
          >
            <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between", mb: 1.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {dept.name}
              </Typography>
              <Chip size="small" label={dept.people.length} sx={{ height: 20 }} />
            </Stack>

            {people.length === 0 ? (
              <Typography variant="caption" color="text.secondary">
                {q ? "Nobody here matches." : "Nobody assigned."}
              </Typography>
            ) : (
              <Stack spacing={0.75}>
                {people.map((person, index) => (
                  <Stack key={person.id} direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
                    {/* The dotted spine: a department is a ladder, and the
                        connector makes the ordering read as one rather than as
                        an arbitrary list. */}
                    <Box
                      sx={{
                        width: 14,
                        alignSelf: "stretch",
                        position: "relative",
                        flexShrink: 0,
                        "&::before": {
                          content: '""',
                          position: "absolute",
                          left: 6,
                          top: index === 0 ? "50%" : 0,
                          bottom: index === people.length - 1 ? "50%" : 0,
                          borderLeft: "1px dashed",
                          borderColor: "divider",
                        },
                        "&::after": {
                          content: '""',
                          position: "absolute",
                          left: 3,
                          top: "calc(50% - 3px)",
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          bgcolor: person.rank ? "primary.main" : "text.disabled",
                        },
                      }}
                    />
                    <Box
                      component="button"
                      onClick={() => onOpen?.(person.id)}
                      sx={{
                        flex: 1,
                        minWidth: 0,
                        textAlign: "left",
                        font: "inherit",
                        border: "none",
                        bgcolor: "transparent",
                        cursor: "pointer",
                        px: 1,
                        py: 0.75,
                        borderRadius: 1.5,
                        "&:hover": { bgcolor: "action.hover" },
                      }}
                    >
                      <Typography variant="body2" sx={{ fontWeight: 650 }} noWrap>
                        {person.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                        {person.designation ?? "—"}
                        {person.rank ? ` · rank ${person.rank}` : ""}
                      </Typography>
                    </Box>
                  </Stack>
                ))}
              </Stack>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
