"""Turn the raw captures into the marked-up figures the manual uses.

Positions come from `boxes.json`, which the capture run wrote by asking the
browser where each element actually was — not from numbers typed in here. A
marking placed by eye is wrong the first time a button moves, and nobody
notices until a reader is staring at a red circle round empty space.

Where an element could not be located the mark is skipped rather than drawn at
a guess: a figure with three callouts instead of four is honest; a fourth
pointing at nothing is not.

    python docs/make_figures.py <shots-dir> <out-dir>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from annotate import Shot  # noqa: E402


def build(shots: Path, out: Path) -> None:
    boxes = json.loads((shots / "boxes.json").read_text(encoding="utf-8"))

    def parts(page: str) -> dict:
        return boxes.get(page, {})

    def at(page: str, key: str):
        """The recorded box, or None. Callers skip the mark when it is None."""
        return parts(page).get(key)

    made: list[str] = []

    # ── Figure: the employee list, and the arrangement every list copies ──
    page = "b01-employees"
    if (shots / f"{page}.png").exists():
        shot = Shot(shots / f"{page}.png")
        n = 1
        if (b := at(page, "search")):
            shot.box(b["x1"] - 0.004, b["y1"] - 0.01, b["x2"] + 0.004, b["y2"] + 0.01)
            shot.point(n, b["x1"] - 0.012, b["cy"]); n += 1
        if (b := at(page, "tabs")):
            shot.point(n, b["x1"] - 0.012, b["cy"]); n += 1
        if (b := at(page, "chips")):
            shot.box(b["x1"] - 0.004, b["y1"] - 0.012, b["x2"] + 0.004, b["y2"] + 0.012)
            shot.point(n, b["x1"] - 0.012, b["cy"]); n += 1
        if (b := at(page, "firstRow")):
            shot.box(b["x1"], b["y1"], b["x2"], b["y2"])
            # Just outside the row, not on top of the name it points at.
            shot.point(n, b["x1"] - 0.012, b["cy"]); n += 1
        if (b := at(page, "add")):
            shot.point(n, b["x1"] - 0.012, b["cy"]); n += 1
        made.append(str(shot.save(out / "fig-employees.png")))

    # ── Figure: the memorandum desk, three sections ──────────────────────
    page = "b02-memoranda"
    if (shots / f"{page}.png").exists():
        shot = Shot(shots / f"{page}.png")
        n = 1
        for key in ("newMemo", "actions", "search"):
            if (b := at(page, key)):
                shot.point(n, b["x1"] - 0.012, b["cy"]); n += 1
        for key, caption in (
            ("needsYou", "Waiting on you"),
            ("raisedByYou", "Yours"),
            ("handled", "Already signed"),
        ):
            if (b := at(page, key)):
                shot.point(n, b["x1"] - 0.012, b["cy"]); n += 1
        made.append(str(shot.save(out / "fig-memoranda.png")))

    # ── Figure: the configurable action table ────────────────────────────
    page = "b03-memorandum-actions"
    if (shots / f"{page}.png").exists():
        shot = Shot(shots / f"{page}.png")
        n = 1
        if (b := at(page, "add")):
            shot.point(n, b["x1"] - 0.012, b["cy"]); n += 1
        if (b := at(page, "table")):
            shot.box(b["x1"], b["y1"], b["x2"], min(b["y2"], 0.98))
            shot.point(n, b["x1"] + 0.03, b["y1"] + 0.06); n += 1
        made.append(str(shot.save(out / "fig-memorandum-actions.png")))

    # ── Figure: field visits ─────────────────────────────────────────────
    page = "b05-field-visits"
    if (shots / f"{page}.png").exists():
        shot = Shot(shots / f"{page}.png")
        n = 1
        for key in ("newVisit", "search", "purpose"):
            if (b := at(page, key)):
                shot.point(n, b["x1"] - 0.012, b["cy"]); n += 1
        if (b := at(page, "chips")):
            shot.box(b["x1"] - 0.004, b["y1"] - 0.012, b["x2"] + 0.004, b["y2"] + 0.012)
            shot.point(n, b["x1"] - 0.012, b["cy"]); n += 1
        made.append(str(shot.save(out / "fig-field-visits.png")))

    # ── The rest go through unmarked, only resized ───────────────────────
    #
    # A screenshot that illustrates rather than instructs needs no callouts,
    # and a red circle on every figure stops meaning "look here".
    plain = {
        "01-login": "fig-login",
        "02-dashboard": "fig-dashboard",
        "04-org-chart": "fig-org-chart",
        "08-events": "fig-events",
        "09-companies": "fig-companies",
        "10-attendance": "fig-attendance",
        "11-leave": "fig-leave",
        "13-expenses": "fig-expenses",
        "14-expense-budgets": "fig-expense-budgets",
        "15-assets": "fig-assets",
        "16-training": "fig-training",
        "17-helpdesk": "fig-helpdesk",
        "18-recruitment": "fig-recruitment",
        "19-timesheets": "fig-timesheets",
        "20-team": "fig-team",
        "21-settings": "fig-settings",
        "22-calendar": "fig-calendar",
        "30-employee-profile": "fig-employee-profile",
        "31-employee-edit": "fig-employee-edit",
        "32-memorandum-new": "fig-memorandum-new",
        "33-memorandum-chain": "fig-memorandum-chain",
        "34-memorandum-open": "fig-memorandum-open",
        "35-memorandum-history": "fig-memorandum-history",
        "36-field-visit-new": "fig-field-visit-new",
        "37-payroll-run": "fig-payroll-run",
        "38-statutory-rates": "fig-statutory-rates",
        "39-employee-conduct": "fig-employee-conduct",
        "40-training-program": "fig-training-program",
    }
    for source, target in plain.items():
        path = shots / f"{source}.png"
        if path.exists():
            made.append(str(Shot(path).save(out / f"{target}.png")))

    print(f"{len(made)} figures -> {out}")


if __name__ == "__main__":
    build(Path(sys.argv[1]), Path(sys.argv[2]))
