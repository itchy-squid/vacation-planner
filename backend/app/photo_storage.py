"""Mirror a pin's chosen photo into Azure Blob Storage, and hand back a
short-lived signed URL for anyone reading it back.

A pin's photo starts out hotlinked from whatever URL was pasted into the
new-pin form's Image link field (see pages/NewPin.jsx) — that's fine for
the moment it's picked, but leaving a trip's pins permanently dependent
on a third-party host staying up (and serving hotlinked traffic to a
stranger's group vacation board) is a different thing to sign up for
indefinitely.
So once a photo is actually chosen for a pin (see routers/pins.py's
_mirror_pin_photo, run as a background task after the pin is saved), a
copy is streamed into our own private blob container and the pin's
photo_url is swapped over to that copy.

Private, not public: these are copies of someone else's photos, so the
container grants no anonymous access (see infra/modules/storage-account.
bicep) — only trip contributors ever see a URL for one, and even that URL
stops working after a few hours. The backend's own reads/writes use its
managed identity directly (no SAS needed for those); a *signed* URL is
minted only when a pin is about to be handed to a client, via
sign_photo_url below (called from PinOut's model_validator in schemas.py,
the one place every pin response passes through, list views included).
That signing uses a user-delegation key rather than an account key, so
there is still no long-lived credential to leak — same reasoning as
app/db.py's Postgres token provider, just for a different Azure service.

Local dev has no storage account (see .env.example) and simply skips all
of this: mirror_photo_to_blob and sign_photo_url both no-op (return None)
when azure_storage_account_url isn't set, so pins keep showing their
hotlinked photo forever in that environment, exactly like before this
module existed.
"""

from __future__ import annotations

import logging
import mimetypes
import threading
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urljoin

import httpx

from .config import Settings, get_settings
from .net_guard import (
    BROWSER_HEADERS,
    MAX_REDIRECTS,
    TIMEOUT_SECONDS,
    UnsafeUrlError,
    require_public_http_url,
)

logger = logging.getLogger(__name__)

# A generous cap for a single photo — large enough for a real, uncropped
# source image, small enough that a mislabeled non-image response or a
# hostile server can't turn "copy one photo" into an unbounded download.
# Enforced while streaming (_capped_chunks), so a too-large source is
# stopped mid-transfer rather than after paying for the whole thing.
MAX_PHOTO_BYTES = 15 * 1024 * 1024

# Deliberately narrower than "starts with image/": rules out image/svg+xml
# (can carry script) and other formats not worth mirroring. This is the
# one place that actually matters, since photo_url on PinCreate/PinUpdate
# is a normal API field a client could set directly to anything.
_ALLOWED_CONTENT_TYPES = {
    "image/jpeg": ".jpg",
    "image/pjpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
    "image/bmp": ".bmp",
    "image/tiff": ".tiff",
}

# How long a minted read URL keeps working, and how long the underlying
# user-delegation key is cached for before asking Azure Storage for a
# fresh one. The key is refreshed well before its own expiry so a signed
# URL minted near the end of the cache window is never signed against a
# key about to expire out from under it.
SAS_LIFETIME = timedelta(hours=6)
DELEGATION_KEY_LIFETIME = timedelta(hours=12)
_CLOCK_SKEW_BUFFER = timedelta(minutes=5)


class PhotoMirrorError(Exception):
    """Something kept this specific photo from being copied — a bad
    response, an unsupported content type, too many redirects, too many
    bytes. Always caught inside this module; callers only ever see
    mirror_photo_to_blob return None."""


def is_configured(settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    return bool(settings.azure_storage_account_url)


@dataclass
class _ServiceHandle:
    account_url: str
    container_name: str


_service_lock = threading.Lock()
_service_handle: _ServiceHandle | None = None
_service_client = None  # azure.storage.blob.BlobServiceClient, built lazily
_delegation_key = None
_delegation_key_expiry: datetime | None = None
_delegation_lock = threading.Lock()


def _blob_service_client(settings: Settings):
    """Lazy singleton — building it touches DefaultAzureCredential, which
    is worth doing once per process rather than per request."""
    global _service_client, _service_handle
    with _service_lock:
        if _service_client is not None and _service_handle.account_url == settings.azure_storage_account_url:
            return _service_client
        from azure.identity import DefaultAzureCredential
        from azure.storage.blob import BlobServiceClient

        credential = (
            DefaultAzureCredential(managed_identity_client_id=settings.azure_client_id)
            if settings.azure_client_id
            else DefaultAzureCredential()
        )
        _service_client = BlobServiceClient(account_url=settings.azure_storage_account_url, credential=credential)
        _service_handle = _ServiceHandle(settings.azure_storage_account_url, settings.azure_storage_container)
        return _service_client


def _container_client(settings: Settings):
    return _blob_service_client(settings).get_container_client(settings.azure_storage_container)


def is_our_blob_url(url: str | None, settings: Settings | None = None) -> bool:
    """True for a URL this module already produced (the base form, or one
    with a SAS query string appended) — used both to avoid re-mirroring a
    pin's own already-mirrored photo, and to decide whether a pin's
    photo_url is even ours to sign in the first place."""
    if not url:
        return False
    settings = settings or get_settings()
    if not settings.azure_storage_account_url:
        return False
    prefix = f"{settings.azure_storage_account_url.rstrip('/')}/{settings.azure_storage_container}/"
    return url.startswith(prefix)


def _extension_for(content_type: str) -> str:
    ext = _ALLOWED_CONTENT_TYPES.get(content_type)
    if ext:
        return ext
    # Shouldn't happen (callers check _ALLOWED_CONTENT_TYPES first), but
    # never let an extension lookup be the reason a mirror fails outright.
    return mimetypes.guess_extension(content_type) or ".jpg"


def _blob_name(trip_id: int, pin_id: int, content_type: str) -> str:
    # uuid4 rather than anything derived from the source URL: two pins
    # (or the same pin, edited twice) picking the same source photo still
    # get independent blobs, so one can be deleted or replaced without
    # touching the other.
    return f"trip-{trip_id}/pin-{pin_id}/{uuid.uuid4().hex}{_extension_for(content_type)}"


def _capped_chunks(chunks, max_bytes: int):
    """Passes bytes through unchanged, but raises once more than
    max_bytes has gone by — mid-stream, before the rest of an oversized
    source is even downloaded. The container/block-blob client consuming
    this generator sees the exception before it ever commits a blob, so a
    too-large source never results in a truncated (corrupt) blob."""
    total = 0
    for chunk in chunks:
        total += len(chunk)
        if total > max_bytes:
            raise PhotoMirrorError(f"Photo exceeded {max_bytes} bytes")
        yield chunk


def _stream_to_blob(url: str, settings: Settings, *, trip_id: int, pin_id: int) -> str:
    """Follows redirects by hand so every hop is re-validated, then
    streams the response body straight into a new blob without holding
    the whole image in memory. Returns the new blob's base URL (no SAS)
    on success; raises PhotoMirrorError or UnsafeUrlError otherwise."""
    from azure.storage.blob import ContentSettings

    current = url
    with httpx.Client(
        follow_redirects=False,
        timeout=TIMEOUT_SECONDS,
        headers={**BROWSER_HEADERS, "Accept": "image/*"},
    ) as client:
        for _ in range(MAX_REDIRECTS + 1):
            require_public_http_url(current)
            with client.stream("GET", current) as response:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        raise PhotoMirrorError("Redirect with no Location header")
                    current = urljoin(current, location)
                    continue
                if response.status_code >= 400:
                    raise PhotoMirrorError(f"Source returned {response.status_code}")

                content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
                if content_type not in _ALLOWED_CONTENT_TYPES:
                    raise PhotoMirrorError(f"Unsupported content type: {content_type!r}")

                blob_name = _blob_name(trip_id, pin_id, content_type)
                blob_client = _container_client(settings).get_blob_client(blob_name)
                blob_client.upload_blob(
                    data=_capped_chunks(response.iter_bytes(), MAX_PHOTO_BYTES),
                    overwrite=True,
                    content_settings=ContentSettings(content_type=content_type),
                )
                return blob_client.url
    raise PhotoMirrorError("Too many redirects")


def mirror_photo_to_blob(url: str, *, trip_id: int, pin_id: int, settings: Settings | None = None) -> str | None:
    """Best-effort: copies `url` into blob storage and returns the new
    blob's base URL, or None if storage isn't configured (local dev) or
    the copy failed for any reason. Never raises — a photo that can't be
    mirrored just means the pin keeps its original hotlink, which is the
    state it was already in, not a new failure mode for the pin itself."""
    settings = settings or get_settings()
    if not is_configured(settings):
        return None
    if is_our_blob_url(url, settings):
        return None  # already one of ours — nothing to do
    try:
        require_public_http_url(url)
        return _stream_to_blob(url, settings, trip_id=trip_id, pin_id=pin_id)
    except (UnsafeUrlError, PhotoMirrorError, httpx.HTTPError) as exc:
        logger.warning("Couldn't mirror photo for pin %s (trip %s): %s", pin_id, trip_id, exc)
        return None
    except Exception:
        # Anything from the Azure SDK itself (auth, throttling, a
        # transient service error) — same outcome as the expected
        # failure modes above: log it, keep the pin's existing photo.
        logger.exception("Unexpected error mirroring photo for pin %s (trip %s)", pin_id, trip_id)
        return None


def _user_delegation_key(settings: Settings):
    global _delegation_key, _delegation_key_expiry
    with _delegation_lock:
        now = datetime.now(UTC)
        if _delegation_key is None or _delegation_key_expiry is None or (_delegation_key_expiry - now) < SAS_LIFETIME:
            service_client = _blob_service_client(settings)
            start = now - _CLOCK_SKEW_BUFFER
            expiry = now + DELEGATION_KEY_LIFETIME
            _delegation_key = service_client.get_user_delegation_key(start, expiry)
            _delegation_key_expiry = expiry
        return _delegation_key


def sign_photo_url(blob_base_url: str, settings: Settings | None = None) -> str | None:
    """Appends a short-lived, read-only SAS query string to one of our own
    blob URLs. Returns None (rather than raising) if storage isn't
    configured or signing fails for any reason — PinOut's model_validator
    (schemas.py) treats that the same as "no photo", falling back to the
    board's placeholder rather than handing out a broken link.

    Callers must already know `blob_base_url` is ours — see
    is_our_blob_url — since a stray external URL passed in here would
    just fail to parse and return None anyway, but checking first avoids
    generating a delegation key on every pin fetch for pins that were
    never mirrored (e.g. every trip created before storage was on, or a
    dev environment where it's never configured)."""
    settings = settings or get_settings()
    if not is_configured(settings):
        return None
    try:
        from azure.storage.blob import BlobSasPermissions, generate_blob_sas

        settings_prefix = f"{settings.azure_storage_account_url.rstrip('/')}/{settings.azure_storage_container}/"
        blob_name = blob_base_url[len(settings_prefix) :]
        account_name = _blob_service_client(settings).account_name

        key = _user_delegation_key(settings)
        now = datetime.now(UTC)
        sas = generate_blob_sas(
            account_name=account_name,
            container_name=settings.azure_storage_container,
            blob_name=blob_name,
            user_delegation_key=key,
            permission=BlobSasPermissions(read=True),
            expiry=now + SAS_LIFETIME,
            start=now - _CLOCK_SKEW_BUFFER,
        )
        return f"{blob_base_url}?{sas}"
    except Exception:
        logger.exception("Couldn't sign a read URL for %s", blob_base_url)
        return None
