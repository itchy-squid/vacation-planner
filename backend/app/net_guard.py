"""SSRF guard for backend code that fetches a URL a user supplied
directly — currently just photo_storage.py, mirroring the image link
pasted into the new-pin form into blob storage. Kept as its own module
rather than inlined there so the address-family check has exactly one
place to get right as this backend grows more "read something the user
pointed at" features.

This process runs in an Azure Container App next to the instance metadata
service (169.254.169.254) and a PostgreSQL Flexible Server on a private
address — both reachable from here but not from the internet — so a
caller-influenced outbound request is a real SSRF primitive, not a
theoretical one. See require_public_http_url's docstring for what it
checks and why every redirect hop needs the same check repeated.
"""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

# Sites vary the page they serve by user agent, and some — commercial
# travel/booking sites especially — outright block anything that
# self-identifies as a bot (the "compatible; SomeBot/1.0; +url" format
# below, which this used to use, is exactly the pattern most bot-blocking
# rules match on, since it's also the convention legitimate crawlers use
# to identify themselves). A person pasting a link into their own trip
# planner is not a bot in the sense those rules exist for, so this looks
# like an ordinary browser instead — same markup a person would have
# seen, which is the point (see require_public_http_url's docstring for
# what still stops this from being pointed at arbitrary internal hosts).
#
# This is a best-effort measure, not a guarantee: a host whose bot
# defenses run a JavaScript challenge or fingerprint the TLS handshake
# (Cloudflare/Akamai/PerimeterX-style) will still refuse a plain HTTP
# client no matter what headers it sends, since defeating that requires
# actually running a browser. photo_storage.py already treats a fetch
# failure as "leave the pin's photo hotlinked instead of mirrored"
# rather than an error the user has to deal with, so a host like that
# just means the photo never gets copied into blob storage, not a
# broken pin.
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)
# Sent alongside USER_AGENT by both fetchers below. Accept-Language in
# particular is a field some bot filters check for specifically because
# plain HTTP clients often omit it.
BROWSER_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept-Language": "en-US,en;q=0.9",
}
TIMEOUT_SECONDS = 6.0
MAX_REDIRECTS = 3


class UnsafeUrlError(Exception):
    """A URL that backend code must not fetch on a user's behalf: any
    scheme but http(s), or a hostname that resolves to a private,
    loopback, link-local, or otherwise non-public address.
    photo_storage.py logs it and leaves the pin's existing photo alone
    rather than raising it as a user-facing error."""


def require_public_http_url(url: str) -> None:
    """Raises UnsafeUrlError unless `url` is http(s) with a hostname that
    resolves only to public addresses. Call this for the caller's own URL
    *and* again for every redirect target before following it — a
    redirect is just another caller-influenced URL, and checking only the
    first hop would miss a public URL that redirects inward."""
    parts = urlparse(url)
    if parts.scheme not in ("http", "https"):
        raise UnsafeUrlError(f"Unsupported scheme: {parts.scheme!r}")
    host = parts.hostname
    if not host:
        raise UnsafeUrlError("No hostname in URL")

    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise UnsafeUrlError(f"Could not resolve host: {host!r}") from exc

    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        # is_global is false for loopback, private ranges, link-local
        # (including 169.254.169.254), multicast, and the reserved
        # blocks — one check instead of a list that drifts. The extras
        # cover addresses is_global treats as public but that we still
        # don't want to originate requests to.
        if not address.is_global or address.is_reserved or address.is_multicast:
            raise UnsafeUrlError(f"Host resolves to a non-public address: {host!r} -> {address}")
