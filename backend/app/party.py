"""Who a plan is for.

A plan's party is a set of travelers (models.Traveler), stored as two
columns read together:

- ``party_mode = "only"``: exactly the travelers in ``party``.
- ``party_mode = "except"``: everyone on the trip but the travelers in
  ``party`` — including anyone added to the trip later. Everyone is
  ``("except", [])``.

That's how the group splitting up is modelled. Ana and Lin on the Taroko
Gorge trail from 08:00 to 11:00, and everyone else biking Liyu Lake over
the same hours, are two ordinary plans whose parties don't share a person.
Nothing else records "a split"; the day grid draws one wherever it finds
plans like that. When a group splits, one side can be the one newcomers
join — that side is stored as "except", so a traveler added next week is
on it without anything being written.

The rule every overlap check reads is ``parties_meet``: two plans collide
only if their hours overlap *and* someone is on both. Two "except" parties
always meet, because the next person added to the trip would be on both.

Parties are always stored normalized (``normalize_party``): sorted,
de-duplicated, only ids of travelers on the trip, and ("except", []) when
the set is the whole roster — a plan for all seven of us is a plan for
everyone, and the eighth person who joins is on it.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Traveler

ONLY = "only"
EXCEPT = "except"
MODES = (ONLY, EXCEPT)


@dataclass(frozen=True)
class Party:
    mode: str
    ids: tuple[int, ...]

    @property
    def is_everyone(self) -> bool:
        return self.mode == EXCEPT and not self.ids

    def members(self, roster: set[int]) -> set[int]:
        if self.mode == ONLY:
            return set(self.ids) & roster
        return roster - set(self.ids)


EVERYONE = Party(EXCEPT, ())


def party_of(row) -> Party:
    """The Party a Plan or Contest row stores."""
    return Party(row.party_mode or EXCEPT, tuple(row.party or ()))


def roster_ids(db: Session, trip_id: int) -> set[int]:
    return set(db.scalars(select(Traveler.id).where(Traveler.trip_id == trip_id)).all())


def encode(members: set[int], roster: set[int], mode: str = ONLY) -> Party:
    """The stored form of a set of travelers, keeping `mode` unless the
    set is the whole trip (then it's everyone)."""
    members = members & roster
    if members >= roster:
        return EVERYONE
    if mode == EXCEPT:
        return Party(EXCEPT, tuple(sorted(roster - members)))
    return Party(ONLY, tuple(sorted(members)))


def normalize_party(db: Session, trip_id: int, ids: Iterable[int] | None, mode: str | None = None) -> Party:
    """Validate and normalize a party a client sent. `mode` defaults to
    "only", and an empty "only" list means everyone — which is what [] has
    always meant."""
    mode = mode or ONLY
    if mode not in MODES:
        raise HTTPException(status_code=400, detail="party_mode must be 'only' or 'except'")
    wanted = set(ids or ())
    if mode == ONLY and not wanted:
        return EVERYONE
    roster = roster_ids(db, trip_id)
    if wanted - roster:
        raise HTTPException(status_code=400, detail="Everyone in a plan's party has to be a traveler on the trip")
    members = Party(mode, tuple(wanted)).members(roster)
    if not members:
        raise HTTPException(status_code=400, detail="Nobody would be on that plan")
    return encode(members, roster, mode)


def apply_party(row, party: Party) -> None:
    """Write a Party onto a Plan or Contest row."""
    row.party = list(party.ids)
    row.party_mode = party.mode


def parties_meet(a: Party | None, b: Party | None, roster: set[int]) -> bool:
    """Whether someone is, or would be, on both. None is everyone."""
    a = a or EVERYONE
    b = b or EVERYONE
    if a.mode == EXCEPT and b.mode == EXCEPT:
        return True
    return not a.members(roster).isdisjoint(b.members(roster))


def traveler_rows(db: Session, ids: Iterable[int]) -> list[Traveler]:
    ids = list(ids)
    if not ids:
        return []
    return list(
        db.scalars(select(Traveler).where(Traveler.id.in_(ids)).order_by(Traveler.position, Traveler.id)).all()
    )


def names(db: Session, ids: Iterable[int]) -> str:
    """"Ana and Lin", "Mei, Jae and Theo". Roster order."""
    got = [t.name for t in traveler_rows(db, ids)]
    if not got:
        return "nobody"
    if len(got) == 1:
        return got[0]
    return ", ".join(got[:-1]) + " and " + got[-1]


def shared_people(db: Session, trip_id: int, a: Party | None, b: Party | None) -> list[str]:
    """Names of the travelers on both parties, roster order — used to say
    who is double-booked rather than just that something is."""
    roster = roster_ids(db, trip_id)
    both = (a or EVERYONE).members(roster) & (b or EVERYONE).members(roster)
    return [t.name for t in traveler_rows(db, both)]
