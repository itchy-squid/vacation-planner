"""Send stray browser navigations on the API host to the SPA.

The SPA and this API live on different hosts (vacations.<env> vs
vacations-api.<env>). When Easy Auth can't honour a login's
post_login_redirect_uri it finishes on its own /.auth/login/done page on
*this* host, and that page's "Return to website" button links to this
host's "/". Rather than leave users on a JSON 404, any GET that isn't an
API route is redirected to the same path on the frontend.

Registered last in app/main.py, so real routes (/api/*, /healthz, the
OpenAPI docs) always match first. /.auth/* never gets here at all -- the
platform intercepts it. Unknown /api/* paths still 404: API clients
should get an error, not an HTML page.

The redirect target's host is always settings.frontend_url, never taken
from the request, so this can't be used as an open redirect.
"""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

from ..config import get_settings

router = APIRouter(include_in_schema=False)


@router.api_route("/{path:path}", methods=["GET", "HEAD"])
def redirect_to_spa(path: str, request: Request) -> RedirectResponse:
    frontend_url = get_settings().frontend_url
    if not frontend_url or path == "api" or path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not Found")
    target = f"{frontend_url.rstrip('/')}/{path.lstrip('/')}"
    if request.url.query:
        target += f"?{request.url.query}"
    return RedirectResponse(target, status_code=302)
