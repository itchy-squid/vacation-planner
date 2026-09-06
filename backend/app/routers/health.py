from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/healthz")
def healthz() -> dict[str, str]:
    """Container Apps liveness/readiness probe target — see
    infra/modules/containerapp.bicep."""
    return {"status": "ok"}
