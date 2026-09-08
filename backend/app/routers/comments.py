from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import get_current_contributor, get_current_principal
from ..db import get_db
from ..events import bus
from ..models import Comment, Pin
from ..schemas import CommentCreate, CommentOut

router = APIRouter(prefix="/api", tags=["comments"])


@router.get("/pins/{pin_id}/comments", response_model=list[CommentOut])
def list_pin_comments(pin_id: int, db: Session = Depends(get_db)):
    return db.scalars(select(Comment).where(Comment.pin_id == pin_id).order_by(Comment.created_at)).all()


@router.post("/trips/{trip_id}/comments", response_model=CommentOut, status_code=201)
def create_comment(trip_id: int, payload: CommentCreate, request: Request, db: Session = Depends(get_db)):
    if payload.pin_id:
        pin = db.get(Pin, payload.pin_id)
        if not pin or pin.trip_id != trip_id:
            raise HTTPException(status_code=404, detail="Pin not found on this trip")

    contributor = get_current_contributor(trip_id=trip_id, principal=get_current_principal(request), db=db)
    comment = Comment(
        pin_id=payload.pin_id,
        plan_id=payload.plan_id,
        contributor_id=contributor.id,
        body=payload.body,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    bus.publish(trip_id, "comment.created", {"comment_id": comment.id, "pin_id": payload.pin_id})
    return comment
