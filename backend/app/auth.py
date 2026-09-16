"""Identity via Azure Container Apps / App Service built-in auth ("Easy
Auth") with Microsoft Entra ID and/or Google, per the project's AskUserQuestion answer:
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

from fastapi import HTTPException, Request, status

from .config import get_settings

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

# Easy Auth's `auth_typ` / X-MS-CLIENT-PRINCIPAL-IDP value for Google.
GOOGLE_PROVIDER = "google"
# Users are keyed by email alone (see app/permissions.py), so an email
# Google hasn't verified must never be trusted: a Google account can be
# created with someone else's non-Gmail address as its login.
_EMAIL_VERIFIED_CLAIM = "email_verified"


class _Rejected:
    """A principal header that parsed fine but must not be trusted. Distinct
    from None (unparseable) so get_principal doesn't fall back to the
    simpler headers, which carry the same unverified identity."""


_REJECTED = _Rejected()


@dataclass(frozen=True)
class Principal:
    object_id: str | None
    email: str
    display_name: str
    identity_provider: str | None


def _parse_client_principal_header(raw: str, principal_id: str | None) -> Principal | _Rejected | None:
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

    provider = payload.get("auth_typ")
    if provider == GOOGLE_PROVIDER and claim_map.get(_EMAIL_VERIFIED_CLAIM, "").lower() != "true":
        return _REJECTED

    return Principal(
        object_id=payload.get("userId") or principal_id,
        email=email,
        display_name=name or email.split("@")[0],
        identity_provider=provider,
    )


def get_principal(request: Request) -> Principal | None:
    """Best-effort extraction of the signed-in user from Easy Auth headers.
    Returns None if no headers are present (local dev, or Easy Auth not yet
    turned on) — callers decide whether that's fatal."""

    header = request.headers.get(CLIENT_PRINCIPAL_HEADER)
    if header:
        principal = _parse_client_principal_header(header, request.headers.get(CLIENT_PRINCIPAL_ID_HEADER))
        if principal is _REJECTED:
            return None
        if principal:
            return principal

    # Fallback: the simpler always-present headers Easy Auth also sets.
    # Not for Google: these carry no email_verified claim to check.
    name = request.headers.get(CLIENT_PRINCIPAL_NAME_HEADER)
    if name and request.headers.get(CLIENT_PRINCIPAL_IDP_HEADER) != GOOGLE_PROVIDER:
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


# Whether that person may do anything on a particular trip is answered by
# app/permissions.py (their Contributor row's role). There is no dev-mode
# auto-enrolment any more: joining a trip happens through an invite link.
