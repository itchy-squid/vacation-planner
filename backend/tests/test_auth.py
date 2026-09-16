"""Easy Auth principal parsing for Entra ID and Google (app/auth.py)."""

from __future__ import annotations

import base64
import json

from starlette.requests import Request

from app.auth import get_principal

EMAIL_URI = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"


def _request(headers: dict[str, str]) -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    return Request({"type": "http", "headers": raw})


def _blob(auth_typ: str, claims: dict[str, str]) -> str:
    payload = {"auth_typ": auth_typ, "claims": [{"typ": t, "val": v} for t, v in claims.items()]}
    return base64.b64encode(json.dumps(payload).encode()).decode()


def _google(claims: dict[str, str], **extra: str) -> dict[str, str]:
    return {
        "X-MS-CLIENT-PRINCIPAL": _blob("google", claims),
        "X-MS-CLIENT-PRINCIPAL-ID": "1234567890",
        "X-MS-CLIENT-PRINCIPAL-NAME": claims.get(EMAIL_URI, "someone"),
        "X-MS-CLIENT-PRINCIPAL-IDP": "google",
        **extra,
    }


def test_google_verified_email_signs_in():
    p = get_principal(_request(_google({EMAIL_URI: "pat@gmail.com", "email_verified": "true", "name": "Pat Doe"})))
    assert p is not None
    assert p.email == "pat@gmail.com"
    assert p.display_name == "Pat Doe"
    assert p.identity_provider == "google"
    assert p.object_id == "1234567890"


def test_google_verified_claim_is_case_insensitive():
    p = get_principal(_request(_google({EMAIL_URI: "pat@gmail.com", "email_verified": "True"})))
    assert p is not None and p.email == "pat@gmail.com"


def test_google_unverified_email_is_rejected_without_fallback():
    headers = _google({EMAIL_URI: "victim@outlook.com", "email_verified": "false"})
    assert get_principal(_request(headers)) is None


def test_google_missing_verified_claim_is_rejected():
    assert get_principal(_request(_google({EMAIL_URI: "victim@outlook.com"}))) is None


def test_google_never_uses_the_name_header_fallback():
    headers = {"X-MS-CLIENT-PRINCIPAL-NAME": "victim@outlook.com", "X-MS-CLIENT-PRINCIPAL-IDP": "google"}
    assert get_principal(_request(headers)) is None


def test_entra_principal_unchanged():
    headers = {
        "X-MS-CLIENT-PRINCIPAL": _blob("aad", {"preferred_username": "sam@outlook.com", "name": "Sam"}),
        "X-MS-CLIENT-PRINCIPAL-ID": "oid-1",
    }
    p = get_principal(_request(headers))
    assert p is not None
    assert (p.email, p.display_name, p.identity_provider, p.object_id) == ("sam@outlook.com", "Sam", "aad", "oid-1")


def test_name_header_fallback_still_works_for_entra():
    headers = {"X-MS-CLIENT-PRINCIPAL-NAME": "sam@outlook.com", "X-MS-CLIENT-PRINCIPAL-IDP": "aad"}
    p = get_principal(_request(headers))
    assert p is not None and p.email == "sam@outlook.com"
