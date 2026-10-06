"""Candidate photos for a pin, read from the page its link points at
(docs/features/pin-photos-spec.md, "From the link").

The first version of this (removed in 06c26e6) failed because it was the
only way to get a photo: plenty of pages don't ship their photos in the
HTML a plain fetch receives (bot walls, images loaded by JavaScript), and
every empty result was a dead end. Now it's one row in a picker that also
offers pasting a link or going without, so an empty or unreachable result
is an ordinary answer, not an error.

A link copied from Google Images is Google's own wrapper page, which
carries nothing useful in its HTML; the image and the page it was found on
are in its query string, so they're read from there instead (see
_unwrap_google).

What's read, best first: Open Graph / Twitter card images, structured data
(JSON-LD "image"), <link rel="image_src">, then <img> tags that don't look
like icons or tracking pixels. Nothing is fetched beyond the page itself:
the browser drops any candidate that fails to load.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import Literal
from urllib.parse import parse_qs, urljoin, urlparse

import httpx

from .net_guard import (
    BROWSER_HEADERS,
    MAX_REDIRECTS,
    TIMEOUT_SECONDS,
    UnsafeUrlError,
    require_public_http_url,
)

MAX_PHOTOS = 12
# Enough for the <head> and a good stretch of <body> on any real page;
# beyond that it's a download, not a page.
MAX_HTML_BYTES = 2 * 1024 * 1024
# A declared width or height under this is an icon, a badge or a pixel.
MIN_IMG_SIDE = 200

_META_KEYS = (
    "og:image",
    "og:image:url",
    "og:image:secure_url",
    "twitter:image",
    "twitter:image:src",
)
_HTML_TYPES = ("text/html", "application/xhtml+xml")
# google.com, www.google.co.uk, images.google.fr, …
_GOOGLE_HOST = re.compile(r"^(?:www\.|images\.)?google\.(?:com?\.)?[a-z]{2,3}$", re.I)
_HAS_SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*://", re.I)
# Matched against an <img>'s URL and its class/id/alt: things on a page
# that are images but never the photo of the place.
_NOT_A_PHOTO = re.compile(
    r"(logo|icon|sprite|avatar|badge|favicon|emoji|spinner|loader|placeholder|spacer|pixel|tracking|1x1|gravatar)",
    re.I,
)

Status = Literal["ok", "empty", "unreachable"]


@dataclass
class LinkPhotos:
    status: Status
    photos: list[str] = field(default_factory=list)


class _Unreachable(Exception):
    pass


def find_link_photos(link: str) -> LinkPhotos:
    """Never raises: anything that keeps the page from being read is
    "unreachable"."""
    url = _with_scheme(link)
    if url is None:
        return LinkPhotos("unreachable")
    image, page = _unwrap_google(url)
    if image is None:
        return _photos_at(page) if page else LinkPhotos("unreachable")
    # The image someone picked on Google comes first; the page it was on
    # may offer more, but not being able to read it costs nothing.
    found = _photos_at(page) if page else LinkPhotos("empty")
    photos = [image] + [p for p in found.photos if p != image]
    return LinkPhotos("ok", photos[:MAX_PHOTOS])


def _unwrap_google(url: str) -> tuple[str | None, str | None]:
    """(image, page) for a link. A Google Images result
    ("google.com/imgres?imgurl=…&imgrefurl=…") names both; a Google
    redirect ("google.com/url?q=…") names the page; anything else is
    just a page. Either can be None when Google's link is missing it."""
    parts = urlparse(url)
    if not _GOOGLE_HOST.match(parts.hostname or ""):
        return None, url
    query = parse_qs(parts.query)

    def param(*names: str) -> str | None:
        for name in names:
            value = (query.get(name) or [""])[0].strip()
            if value:
                return _absolute(value, url)
        return None

    if parts.path == "/imgres":
        return param("imgurl"), param("imgrefurl")
    if parts.path == "/url":
        return None, param("q", "url")
    return None, url


def _photos_at(url: str) -> LinkPhotos:
    try:
        final_url, kind, body = _fetch(url)
    except (_Unreachable, UnsafeUrlError, httpx.HTTPError, UnicodeError, ValueError):
        return LinkPhotos("unreachable")
    if kind == "image":
        return LinkPhotos("ok", [final_url])
    photos = photos_in_html(body, final_url)
    return LinkPhotos("ok" if photos else "empty", photos)


def _with_scheme(link: str) -> str | None:
    """Links are stored as typed, often without a scheme ("viator.com/…");
    the same rule as the frontend's lib/externalHref.js."""
    link = (link or "").strip()
    if not link:
        return None
    url = link if _HAS_SCHEME.match(link) else f"https://{link}"
    return url if urlparse(url).scheme in ("http", "https") else None


def _fetch(url: str) -> tuple[str, Literal["html", "image"], str]:
    """Follows redirects by hand so each hop is checked by net_guard, the
    same way photo_storage.py does. Returns (final URL, kind, HTML)."""
    current = url
    with httpx.Client(
        follow_redirects=False,
        timeout=TIMEOUT_SECONDS,
        headers={
            **BROWSER_HEADERS,
            "Accept": "text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5",
        },
    ) as client:
        for _ in range(MAX_REDIRECTS + 1):
            require_public_http_url(current)
            with client.stream("GET", current) as response:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        raise _Unreachable("Redirect with no Location header")
                    current = urljoin(current, location)
                    continue
                if response.status_code >= 400:
                    raise _Unreachable(f"Page returned {response.status_code}")
                content_type = (
                    response.headers.get("content-type", "")
                    .split(";")[0]
                    .strip()
                    .lower()
                )
                if (
                    content_type.startswith("image/")
                    and content_type != "image/svg+xml"
                ):
                    return current, "image", ""
                if content_type and content_type not in _HTML_TYPES:
                    raise _Unreachable(f"Not a web page: {content_type!r}")
                raw = bytearray()
                for chunk in response.iter_bytes():
                    raw.extend(chunk)
                    if len(raw) >= MAX_HTML_BYTES:
                        break
                encoding = response.charset_encoding or "utf-8"
                return (
                    current,
                    "html",
                    bytes(raw[:MAX_HTML_BYTES]).decode(encoding, errors="replace"),
                )
    raise _Unreachable("Too many redirects")


def photos_in_html(html: str, page_url: str) -> list[str]:
    """The candidate photos in a page, best first, as absolute http(s)
    URLs. Pure: no network."""
    parser = _PhotoParser()
    parser.feed(html)
    parser.close()
    base = urljoin(page_url, parser.base_href) if parser.base_href else page_url

    ordered = (
        parser.meta
        + [u for block in parser.json_ld for u in _json_ld_images(block)]
        + parser.link_rel
        + parser.imgs
    )
    photos: list[str] = []
    seen: set[str] = set()
    for raw in ordered:
        url = _absolute(raw, base)
        if url and url not in seen:
            seen.add(url)
            photos.append(url)
            if len(photos) == MAX_PHOTOS:
                break
    return photos


def _absolute(raw: str, base: str) -> str | None:
    raw = (raw or "").strip()
    if not raw or raw.startswith("data:"):
        return None
    url = urljoin(base, raw)
    parts = urlparse(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    if parts.path.lower().endswith(".svg"):
        return None
    return url


def _json_ld_images(text: str) -> list[str]:
    try:
        data = json.loads(text)
    except ValueError:
        return []
    found: list[str] = []

    def image_urls(value) -> None:
        if isinstance(value, str):
            found.append(value)
        elif isinstance(value, list):
            for item in value:
                image_urls(item)
        elif isinstance(value, dict):
            url = value.get("url") or value.get("contentUrl")
            if isinstance(url, str):
                found.append(url)

    def walk(node) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                if key in ("image", "photo", "thumbnailUrl"):
                    image_urls(value)
                else:
                    walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(data)
    return found


def _too_small(value: str | None) -> bool:
    if not value:
        return False
    match = re.match(r"\s*(\d+)", value)
    return bool(match) and int(match.group(1)) < MIN_IMG_SIDE


def _largest_in_srcset(srcset: str) -> str | None:
    best, best_size = None, -1.0
    for candidate in srcset.split(","):
        parts = candidate.strip().split()
        if not parts:
            continue
        size = 1.0
        if len(parts) > 1:
            match = re.match(r"([\d.]+)[wx]$", parts[1])
            if match:
                size = float(match.group(1))
        if size > best_size:
            best, best_size = parts[0], size
    return best


class _PhotoParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.meta: list[str] = []
        self.link_rel: list[str] = []
        self.imgs: list[str] = []
        self.json_ld: list[str] = []
        self.base_href: str | None = None
        self._in_json_ld = False
        self._json_ld_text: list[str] = []

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "meta":
            key = (a.get("property") or a.get("name") or "").strip().lower()
            if key in _META_KEYS and a.get("content"):
                self.meta.append(a["content"])
        elif tag == "link":
            if "image_src" in a.get("rel", "").lower().split() and a.get("href"):
                self.link_rel.append(a["href"])
        elif tag == "base":
            if self.base_href is None and a.get("href"):
                self.base_href = a["href"]
        elif tag == "script":
            if a.get("type", "").strip().lower() == "application/ld+json":
                self._in_json_ld = True
                self._json_ld_text = []
        elif tag in ("img", "source"):
            self._img(tag, a)

    def handle_endtag(self, tag):
        if tag == "script" and self._in_json_ld:
            self._in_json_ld = False
            self.json_ld.append("".join(self._json_ld_text))

    def handle_data(self, data):
        if self._in_json_ld:
            self._json_ld_text.append(data)

    def _img(self, tag: str, a: dict[str, str]) -> None:
        if _too_small(a.get("width")) or _too_small(a.get("height")):
            return
        # Lazy-loading sites put the real image in a data- attribute and a
        # placeholder in src, so those are read first.
        srcset = a.get("data-srcset") or a.get("srcset")
        src = (
            a.get("data-src")
            or a.get("data-lazy-src")
            or a.get("data-original")
            or (_largest_in_srcset(srcset) if srcset else None)
            or a.get("src")
        )
        if not src:
            return
        if tag == "source" and not srcset:
            return
        described = " ".join(
            [src, a.get("class", ""), a.get("id", ""), a.get("alt", "")]
        )
        if _NOT_A_PHOTO.search(described):
            return
        self.imgs.append(src)
