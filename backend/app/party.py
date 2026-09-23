"""Who a plan is for.

A plan's `party` is a list of contributor ids, with [] meaning everyone on
the trip. That one column is how the group splitting up is modelled: Ana
and Lin on Taroko Gorge from 08:00 to 14:00, and everyone else on the Liyu
Lake bike loop over the same hours, are two ordinary plans whose parties
don't share a person. Nothing else records "a split"; the day grid draws
one wherever it finds plans like that.

The rule every overlap check reads is `parties_meet`: two plans collide
only if their hours overlap *and* someone is on both. [] meets everything,
because everyone is on it.

Parties are always stored normalized (`normalize_party`), so comparing two
of them is plain list equality:

- sorted and de-duplicated;
- [] rather than a list of the whole roster, so a plan for "all six of us"
  and a plan for "everyone" are the same plan, and someone who joins the
  trip later is on it.
"""

from __future__ import annotations

from collections.abc import Iterable

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Contributor


def roster_ids(db: Session, trip_id: int) -> set[int]:
    return set(db.scalars(select(Contributor.id).where(Contributor.trip_id == trip_id)).all())


def normalize_party(db: Session, trip_id: int, ids: Iterable[int] | None) -> list[int]:
    """The stored form of a party, or a 400 naming the problem. Every id
    has to be someone on this trip. A party that covers the whole roster is
    stored as [], which is what everyone means."""
    wanted = sorted(set(ids or ()))
    if not wanted:
        return []
    roster = roster_ids(db, trip_id)
    strangers = [i for i in wanted if i not in roster]
    if strangers:
        raise HTTPException(status_code=400, detail="Everyone in a plan's party has to be on the trip")
    if set(wanted) >= roster:
        return []
    return wanted


def effective_party(db: Session, trip_id: int, party: list[int] | None) -> set[int]:
    """The actual people on a plan: its party, or the whole roster for []."""
    return set(party) if party else roster_ids(db, trip_id)


def parties_meet(a: list[int] | None, b: list[int] | None) -> bool:
    """Whether someone would be on both plans. The one rule the overlap
    checks, the capture and the vote all read."""
    if not a or not b:
        return True
    return not set(a).isdisjoint(b)


def shared_people(db: Session, trip_id: int, a: list[int] | None, b: list[int] | None) -> list[str]:
    """Display names of the people on both parties, roster order. Used to
    say who is double-booked rather than just that something is."""
    both = effective_party(db, trip_id, a) & effective_party(db, trip_id, b)
    if not both:
        return []
    rows = db.scalars(
        select(Contributor).where(Contributor.id.in_(both)).order_by(Contributor.id)
    ).all()
    return [c.display_name for c in rows]


def names(db: Session, ids: Iterable[int]) -> str:
    """"Ana and Lin", "Mei, Jae and Theo". Roster order."""
    rows = db.scalars(select(Contributor).where(Contributor.id.in_(list(ids))).order_by(Contributor.id)).all()
    got = [c.display_name for c in rows]
    if not got:
        return "nobody"
    if len(got) == 1:
        return got[0]
    return ", ".join(got[:-1]) + " and " + got[-1]
