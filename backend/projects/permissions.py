"""Who may do what to a project.

**Three answers, not two.** Most modules here split into "HR" and "everyone
else", because most modules describe something HR administers. A board does
not. The person who has to move a card is the person doing the work, and a
board where every move needs an administrator is a board nobody will keep up to
date — which makes the completion figures wrong, and those figures are meant to
reach performance conversations.

So the rules are:

* **`workplace.manage`** — the carried-modules permission, per `Perm`. Full
  reach over every project. No new permission was invented: `WORKPLACE_MANAGE`
  already covers timesheets, checklists, goals and the rest, and projects are
  the same kind of thing. Split it the day a customer asks.
* **The project's owner** — full reach over *their* project. A team lead who
  cannot add a task to the project they run has to go and ask somebody, and the
  asking happens outside the system.
* **The task's assignee** — may move and edit the task they were given, and
  nothing else. Deliberately not deletion: dropping a task removes the record
  that it was ever asked for, and "I finished it" and "it never existed" must
  not be the same gesture.

Reading is open to any authenticated user in the company. A board that hides
which work exists produces the duplicated effort it was bought to prevent.
"""

from rest_framework.permissions import SAFE_METHODS, BasePermission

from accounts.policy import Perm, can
from attendance.permissions import _requesting_employee


def is_workplace_manager(user) -> bool:
    """Thin adapter over the one policy, so this file never re-derives it."""
    return can(user, Perm.WORKPLACE_MANAGE)


def owns_project(user, project) -> bool:
    if project is None or project.owner_id is None:
        return False
    employee = _requesting_employee(user)
    return employee is not None and employee.id == project.owner_id


class CanWriteProject(BasePermission):
    """Projects and sprints: read for all, write for managers and the owner."""

    message = "You do not manage this project."

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        if is_workplace_manager(request.user):
            return True
        # Creating a project is a manager's act. Anyone able to create one could
        # otherwise make themselves its owner and inherit the rest of this file.
        return view.action != "create"

    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS:
            return True
        if is_workplace_manager(request.user):
            return True
        # A sprint is reached through its project; a project is its own.
        project = obj if hasattr(obj, "owner_id") else getattr(obj, "project", None)
        return owns_project(request.user, project)


def may_write_task(user, task, *, destructive: bool = False) -> bool:
    """Whether `user` may change `task`.

    Extracted because three places needed the same answer and two of them had
    written their own version: `CanWriteTask`, the attachment viewset's
    `_may_write`, and the board's reorder action. Two copies of a permission
    rule is one copy that will be forgotten when the rule changes.

    `destructive` separates "I finished it" from "it never existed" — an
    assignee closes a task, they do not erase it.
    """
    if is_workplace_manager(user):
        return True
    if owns_project(user, task.project):
        return True
    if destructive:
        return False
    employee = _requesting_employee(user)
    return employee is not None and employee.id == task.assignee_id


class CanWriteTask(BasePermission):
    """Tasks: the assignee may work on theirs; only a manager or owner may
    create or destroy one."""

    message = "That task is not yours to change."

    # No `has_permission` override. Creation is decided by
    # `ProjectTaskViewSet.perform_create`, because which project a new task
    # belongs to is in the request body and object-level permission runs only
    # where an object already exists. Everything else is decided per object
    # below.

    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS:
            return True
        return may_write_task(request.user, obj, destructive=request.method == "DELETE")
