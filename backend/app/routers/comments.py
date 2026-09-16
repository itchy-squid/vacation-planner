from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..events import bus
from ..models import Comment, Pin, Plan
from ..permissions import COMMENTS_WRITE, IDEAS_READ, Access, require
from ..schemas import CommentCreate, CommentOut

router = APIRouter(prefix="/api", tags=["comments"])


@router.get("/pins/{pin_id}/comments", response_model=list[CommentOut])
def list_pin_comments(pin_id: int, _: Access = Depends(require(IDEAS_READ)), db: Session = Depends(get_db)):
    return db.scalars(select(Comment).where(Comment.pin_id == pin_id).order_by(Comment.created_at)).all()


@router.post("/trips/{trip_id}/comments", response_model=CommentOut, status_code=201)
def create_comment(
    trip_id: int,
    payload: CommentCreate,
    access: Access = Depends(require(COMMENTS_WRITE)),
    db: Session = Depends(get_db),
):
    if payload.pin_id:
        pin = db.get(Pin, payload.pin_id)
        if not pin or pin.trip_id != trip_id:
            raise HTTPException(status_code=404, detail="Pin not found on this trip")
    if payload.plan_id:
        plan = db.get(Plan, payload.plan_id)
        if not plan or plan.trip_id != trip_id:
            raise HTTPException(status_code=404, detail="Plan not found on this trip")

    comment = Comment(
        pin_id=payload.pin_id,
        plan_id=payload.plan_id,
        contributor_id=access.member.id,
        body=payload.body,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    bus.publish(trip_id, "comment.created", {"comment_id": comment.id, "pin_id": payload.pin_id})
    return comment
