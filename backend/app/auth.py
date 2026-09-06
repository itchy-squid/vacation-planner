"""Identity via Azure Container Apps / App Service built-in auth ("Easy
Auth") with Microsoft Entra ID, per the project's AskUserQuestion answer:
no real sign-in flow is wired up in this pass, but the backend is written
to trust Easy Auth's forwarded headers once it's turned on in front of the
Container App (see infra/modules/containerapp.bicep).

Easy Auth terminates the OIDC flow at the platform edge and forwards the
signed-in identity to the app via request headers — the app never sees a
token or handles a redirect. Locally, with no Easy Auth in front of you,
requests fall back to `settings.dev_user_email` so the rest of the stack
(votes, comments, "who added this pin") has someone to attribute to.
"""

from __future__ import annotations

import base64
import binascii
import json
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import Contributor

CLIENT_PRINCIPAL_HEADER = "X-MS-CLIENT-PRINCIPAL"
CLIENT_PRINCIPAL_ID_HEADER = "X-MS-CLIENT-PRINCIPAL-ID"
CLIENT_PRINCIPAL_NAME_HEADER = "X-MS-CLIENT-PRINCIPAL-NAME"
CLIENT_PRINCIPAL_IDP_HEADER = "X-MS-CLIENT-PRINCIPAL-IDP"

_EMAIL_CLAIM_TYPES = {
    "preferred_username",
    "emails",
    "email",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
}
_NAME_CLAIM_TYPES = {"name", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"}


@dataclass(frozen=True)
class Principal:
    object_id: str | None
    email: str
    display_name: str
    identity_provider: str | None


def _parse_client_principal_header(raw: str) -> Principal | None:
    try:
        decoded = base64.b64decode(raw)
        payload = json.loads(decoded)
    except (binascii.Error, ValueError, json.JSONDecodeError):
        return None

    claims = payload.get("claims", [])
    claim_map: dict[str, str] = {}
    for claim in claims:
        typ = claim.get("typ")
        val = claim.get("val")
        if typ and val and typ not in claim_map:
            claim_map[typ] = val

    email = next((claim_map[t] for t in _EMAIL_CLAIM_TYPES if t in claim_map), None)
    name = next((claim_map[t] for t in _NAME_CLAIM_TYPES if t in claim_map), None)
    if not email:
        return None

    return Principal(
        object_id=payload.get("userId"),
        email=email,
        display_name=name or email.split("@")[0],
        identity_provider=payload.get("auth_typ"),
    )


def get_principal(request: Request) -> Principal | None:
    """Best-effort extraction of the signed-in user from Easy Auth headers.
    Returns None if no headers are present (local dev, or Easy Auth not yet
    turned on) — callers decide whether that's fatal."""

    header = request.headers.get(CLIENT_PRINCIPAL_HEADER)
    if header:
        principal = _parse_client_principal_header(header)
        if principal:
            return principal

    # Fallback: the simpler always-present headers Easy Auth also sets.
    name = request.headers.get(CLIENT_PRINCIPAL_NAME_HEADER)
    if name:
        return Principal(
            object_id=request.headers.get(CLIENT_PRINCIPAL_ID_HEADER),
            email=name,
            display_name=name.split("@")[0],
            identity_provider=request.headers.get(CLIENT_PRINCIPAL_IDP_HEADER),
        )

    return None


def get_current_principal(request: Request) -> Principal:
    settings = get_settings()
    principal = get_principal(request)
    if principal:
        return principal

    if settings.is_development:
        email = settings.dev_user_email
        return Principal(object_id=None, email=email, display_name=email.split("@")[0], identity_provider="dev")

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No authenticated user (Easy Auth headers missing)")


def get_current_contributor(
    trip_id: str,
    principal: Principal = Depends(get_current_principal),
    db: Session = Depends(get_db),
) -> Contributor:
    """Resolves the signed-in principal to a Contributor row scoped to one
    trip. In development, an unknown email is auto-enrolled as a
    non-owner contributor so local testing doesn't require seeding first."""

    settings = get_settings()
    contributor = db.scalar(
        select(Contributor).where(Contributor.trip_id == trip_id, Contributor.email == principal.email)
    )
    if contributor:
        return contributor

    if settings.is_development:
        contributor = Contributor(
            trip_id=trip_id,
            email=principal.email,
            display_name=principal.display_name,
            initial=principal.display_name[:1].upper(),
            is_owner=False,
        )
        db.add(contributor)
        db.commit()
        db.refresh(contributor)
        return contributor

    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a contributor on this trip")
