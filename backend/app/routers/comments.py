"""Comments on an idea, a plan, or a day of the trip.

- Anyone on the trip can read them; companions, planners and owners can
  write them (COMMENTS_WRITE).
- A day comment is on the whole day (app/models.py Comment): the trip's own
  days only, numbered from 1, like the places for a day
  (routers/day_places.py).
- Only the person who wrote a comment can change or delete it.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..events import bus
from ..models import Comment, Pin, Plan, Trip
from ..permissions import COMMENTS_WRITE, IDEAS_READ, PLANS_READ, Access, require
from ..schemas import CommentCreate, CommentOut, CommentUpdate
from ..tripdays import day_count

router = APIRouter(prefix="/api", tags=["comments"])

MAX_BODY = 2000


@router.get("/pins/{pin_id}/comments", response_model=list[CommentOut])
def list_pin_comments(pin_id: int, _: Access = Depends(require(IDEAS_READ)), db: Session = Depends(get_db)):
    return db.scalars(select(Comment).where(Comment.pin_id == pin_id).order_by(Comment.created_at)).all()


@router.get("/trips/{trip_id}/day-comments", response_model=list[CommentOut])
def list_day_comments(trip_id: int, _: Access = Depends(require(PLANS_READ)), db: Session = Depends(get_db)):
    """Every day's comments, by day and then oldest first. Days outside the
    trip (left there when its dates moved) are included; the app shows only
    the trip's own days."""
    return db.scalars(
        select(Comment).where(Comment.trip_id == trip_id).order_by(Comment.day, Comment.created_at, Comment.id)
    ).all()


@router.post("/trips/{trip_id}/comments", response_model=CommentOut, status_code=201)
def create_comment(
    trip_id: int,
    payload: CommentCreate,
    access: Access = Depends(require(COMMENTS_WRITE)),
    db: Session = Depends(get_db),
):
    body = _body(payload.body)
    if sum(x is not None for x in (payload.pin_id, payload.plan_id, payload.day)) > 1:
        raise HTTPException(status_code=422, detail="A comment is on an idea, a plan or a day, not more than one")
    if payload.pin_id:
        pin = db.get(Pin, payload.pin_id)
        if not pin or pin.trip_id != trip_id:
            raise HTTPException(status_code=404, detail="Pin not found on this trip")
    if payload.plan_id:
        plan = db.get(Plan, payload.plan_id)
        if not plan or plan.trip_id != trip_id:
            raise HTTPException(status_code=404, detail="Plan not found on this trip")
    if payload.day is not None:
        last = day_count(db.get(Trip, trip_id))
        if last is None:
            raise HTTPException(status_code=422, detail="Set the trip's dates, or how long it is, before commenting on a day")
        if not 1 <= payload.day <= last:
            raise HTTPException(status_code=422, detail=f"Day {payload.day} isn't one of the trip's days (1 to {last})")

    comment = Comment(
        pin_id=payload.pin_id,
        plan_id=payload.plan_id,
        trip_id=trip_id if payload.day is not None else None,
        day=payload.day,
        contributor_id=access.member.id,
        body=body,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    bus.publish(trip_id, "comment.created", {"comment_id": comment.id, "pin_id": payload.pin_id, "day": payload.day})
    return comment


@router.patch("/trips/{trip_id}/comments/{comment_id}", response_model=CommentOut)
def update_comment(
    trip_id: int,
    comment_id: int,
    payload: CommentUpdate,
    access: Access = Depends(require(COMMENTS_WRITE)),
    db: Session = Depends(get_db),
):
    comment = _own_comment(db, trip_id, comment_id, access)
    comment.body = _body(payload.body)
    comment.edited_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(comment)
    bus.publish(trip_id, "comment.updated", {"comment_id": comment.id, "day": comment.day})
    return comment


@router.delete("/trips/{trip_id}/comments/{comment_id}", status_code=204)
def delete_comment(
    trip_id: int,
    comment_id: int,
    access: Access = Depends(require(COMMENTS_WRITE)),
    db: Session = Depends(get_db),
):
    comment = _own_comment(db, trip_id, comment_id, access)
    day = comment.day
    db.delete(comment)
    db.commit()
    bus.publish(trip_id, "comment.deleted", {"comment_id": comment_id, "day": day})


def _body(text: str) -> str:
    body = text.strip()
    if not body:
        raise HTTPException(status_code=422, detail="Write something first")
    if len(body) > MAX_BODY:
        raise HTTPException(status_code=422, detail=f"Keep it under {MAX_BODY} characters")
    return body


def _own_comment(db: Session, trip_id: int, comment_id: int, access: Access) -> Comment:
    """The comment, if it's on this trip; only its author may change it.
    A comment on another trip is refused the same way as one that doesn't
    exist."""
    comment = db.get(Comment, comment_id)
    if comment is None or _trip_of(db, comment) != trip_id:
        raise HTTPException(status_code=404, detail="Comment not found on this trip")
    if comment.contributor_id != access.member.id:
        raise HTTPException(status_code=403, detail="Only the person who wrote a comment can change it")
    return comment


def _trip_of(db: Session, comment: Comment) -> int | None:
    if comment.trip_id is not None:
        return comment.trip_id
    if comment.pin_id is not None:
        pin = db.get(Pin, comment.pin_id)
        return pin.trip_id if pin else None
    if comment.plan_id is not None:
        plan = db.get(Plan, comment.plan_id)
        return plan.trip_id if plan else None
    return None
