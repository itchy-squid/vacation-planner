"""Why a pin or travel item can't be deleted yet.

Deleting a pin is distinct from unplacing it: the calendar has to let go of
it first, because a PlanItem pointing at a deleted Pin would leave a plan
with a hole in it. Both routers/pins.py and routers/travel_items.py refuse
the same way, and both have to cope with the awkward case drafts introduce
— the plan holding the item may be someone else's private draft, which the
caller can't see, can't open, and can't unplace (feature spec §11). Saying
so by name, with whose draft it is, is the difference between a dead end
and something the person can act on.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from .models import Contributor, Plan, PlanItem, PlanStatus


def scheduled_conflict_detail(db: Session, referenced: PlanItem, noun: str) -> str:
    plan = db.get(Plan, referenced.plan_id)
    if plan is not None and plan.status == PlanStatus.draft:
        author = db.get(Contributor, plan.created_by_id) if plan.created_by_id else None
        whose = f"{author.display_name}'s" if author else "someone's"
        return (
            f"This {noun} is a stop in {whose} draft block — it has to come out of that draft "
            "before it can be deleted."
        )
    return f"This {noun} is scheduled in a plan — remove it from the schedule first"
