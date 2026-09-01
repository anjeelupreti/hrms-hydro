"""Declared status transitions, and the boards built over them.

**A kanban where any card can be dragged to any column is a spreadsheet with
rounded corners.** Declaring which moves are legal is what turns
"open → in progress → resolved → reopened" into a rule rather than a convention
somebody follows until they are busy.

It also gives the board its columns for free: a flow knows its own states, their
order and their labels, so the UI does not maintain a second copy of that list
which drifts from the model's choices.

Used by every surface with a status — the client desk above all — so the rules
live in one place rather than being re-implemented per viewset.
"""

from core.timeline import record_status_change


class TransitionError(Exception):
    """A move the flow does not allow."""


class StatusFlow:
    """A set of states and the moves permitted between them.

    `transitions` maps a state to the states reachable from it. A state absent
    from the mapping is terminal — reachable, and nothing leads out of it.
    """

    def __init__(self, states, transitions, *, terminal=()):
        #: `[(value, label)]`, in board order. Order is data, not alphabetical:
        #: a pipeline reads left to right and sorting it would scramble that.
        self.states = list(states)
        self.transitions = {k: set(v) for k, v in transitions.items()}
        self.terminal = set(terminal)

    @property
    def values(self):
        return [value for value, _ in self.states]

    def label(self, value):
        for candidate, label in self.states:
            if candidate == value:
                return label
        return value

    def can(self, from_value, to_value):
        if from_value == to_value:
            return True  # a no-op is not an illegal move
        return to_value in self.transitions.get(from_value, set())

    def check(self, from_value, to_value):
        if not self.can(from_value, to_value):
            raise TransitionError(
                f"Cannot move from {self.label(from_value)!r} to {self.label(to_value)!r}. "
                f"From here you can go to: "
                f"{', '.join(self.label(s) for s in sorted(self.transitions.get(from_value, ()))) or 'nowhere'}."
            )

    def columns(self):
        """Board columns, in declared order."""
        return [
            {"value": value, "label": label, "is_terminal": value in self.terminal}
            for value, label in self.states
        ]

    def apply(self, obj, to_value, *, timeline_model, actor=None, note="", field="status"):
        """Move an object, recording the transition.

        Recording happens **here** rather than in each caller, so a status that
        changes without a timeline entry is a bug in one place instead of an
        omission in twenty — and duration-in-status stays computable.
        """
        from_value = getattr(obj, field)
        self.check(from_value, to_value)
        if from_value == to_value:
            return obj

        setattr(obj, field, to_value)
        obj.save(update_fields=[field] + (["updated_at"] if hasattr(obj, "updated_at") else []))
        record_status_change(
            timeline_model, obj, from_value, to_value, actor=actor, note=note
        )
        return obj


#: Support — a concern somebody raised.
#:
#: `reopened` is deliberately not a separate state. A reopened ticket **is**
#: open, and giving it its own column splits every "how many are open" count
#: in two. The timeline records that it was resolved once, which is the part
#: worth keeping.
TICKET_FLOW = StatusFlow(
    states=[
        ("open", "Open"),
        ("in_progress", "In progress"),
        ("waiting", "Waiting on customer"),
        ("resolved", "Resolved"),
        ("closed", "Closed"),
    ],
    transitions={
        "open": {"in_progress", "waiting", "resolved", "closed"},
        "in_progress": {"waiting", "resolved", "open", "closed"},
        # Waiting can only go back to us or be abandoned — it cannot jump
        # straight to resolved, because "resolved" while waiting on somebody
        # else is a claim nobody has checked.
        "waiting": {"in_progress", "open", "closed"},
        "resolved": {"closed", "open"},   # reopening is going back to open
        "closed": {"open"},
    },
    terminal=("closed",),
)
