"""Who's signed in — the frontend's session check (frontend/src/lib/api.js
checkSession).

This deliberately stands in for Easy Auth's own `/.auth/me`. On Azure
Container Apps that endpoint is only served when Easy Auth's *token store*
is enabled, and the token store's only supported backing there is a blob
container SAS URL held as a Container App secret
(`login.tokenStore.azureBlobStorage.sasUrlSettingName` — there is no
managed-identity variant in the authConfigs schema, unlike App Service).
Without it `/.auth/me` returns 404 even for a perfectly valid session.

The `X-MS-CLIENT-PRINCIPAL*` headers app/auth.py reads are forwarded with
no token store at all, so the same question gets answered here without
adding a storage account and a long-lived shared secret to infra/ — which
the rest of this project (see infra/sql/provision_roles.sql, app/db.py)
goes out of its way not to have.
"""

from fastapi import APIRouter, Depends

from ..auth import Principal, get_current_principal
from ..schemas import MeOut

router = APIRouter(prefix="/api", tags=["me"])


@router.get("/me", response_model=MeOut)
def read_me(principal: Principal = Depends(get_current_principal)) -> MeOut:
    """The signed-in user, or 401 if there isn't one.

    Three outcomes, and the frontend only needs to tell 200 from 401:

    - **200** — Easy Auth forwarded a principal (production), or
      ENVIRONMENT is a development one and DEV_USER_EMAIL stood in for one
      (local dev, where the Vite proxy forwards /api to the backend).
    - **401 from the platform** — Easy Auth is in front of us and the
      caller has no session. The ingress returns this before the request
      ever reaches FastAPI (authConfig's
      `unauthenticatedClientAction: 'Return401'`).
    - **401 from here** — no Easy Auth headers *and* not development, so
      get_current_principal raises.

    Identity only: whether this person may edit a given trip is
    trip-scoped and answered by Contributor rows (app/auth.py
    get_current_contributor, GET /api/trips/{trip_id}/contributors).
    """

    return MeOut(
        email=principal.email,
        display_name=principal.display_name,
        object_id=principal.object_id,
        identity_provider=principal.identity_provider,
    )
