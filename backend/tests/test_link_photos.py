"""Photos offered from a pin's link (app/link_photos.py,
docs/features/pin-photos-spec.md). Parsing is tested directly; the
endpoint is tested with the fetch stubbed, so nothing here touches the
network."""

import pytest

from app import link_photos
from app.link_photos import LinkPhotos, find_link_photos, photos_in_html
from conftest import as_user

PAGE = "https://example.com/tours/snorkel"


def test_card_images_come_first_then_structured_data_then_img_tags():
    html = """
    <html><head>
      <meta property="og:image" content="https://cdn.example.com/og.jpg">
      <meta name="twitter:image" content="/twitter.jpg">
      <script type="application/ld+json">
        {"@type": "TouristTrip", "image": ["https://cdn.example.com/ld1.jpg", {"url": "https://cdn.example.com/ld2.jpg"}]}
      </script>
      <link rel="image_src" href="https://cdn.example.com/rel.jpg">
    </head><body>
      <img src="https://cdn.example.com/body.jpg">
    </body></html>
    """
    assert photos_in_html(html, PAGE) == [
        "https://cdn.example.com/og.jpg",
        "https://example.com/twitter.jpg",
        "https://cdn.example.com/ld1.jpg",
        "https://cdn.example.com/ld2.jpg",
        "https://cdn.example.com/rel.jpg",
        "https://cdn.example.com/body.jpg",
    ]


def test_json_ld_images_are_found_however_deep():
    html = """<script type="application/ld+json">
      {"@graph": [{"@type": "Restaurant", "photo": {"@type": "ImageObject", "contentUrl": "https://x.com/a.jpg"}},
                  {"@type": "WebPage", "thumbnailUrl": "https://x.com/b.jpg"}]}
    </script><script type="application/ld+json">not json</script>"""
    assert photos_in_html(html, PAGE) == ["https://x.com/a.jpg", "https://x.com/b.jpg"]


def test_icons_logos_pixels_and_svgs_are_left_out():
    html = """
      <img src="/logo.png">
      <img src="/a.jpg" class="site-icon">
      <img src="/b.jpg" alt="Company logo">
      <img src="/c.jpg" width="1" height="1">
      <img src="/d.jpg" width="120">
      <img src="/e.svg">
      <img src="data:image/gif;base64,R0lGOD">
      <img src="/photo.jpg" width="800" height="600">
    """
    assert photos_in_html(html, PAGE) == ["https://example.com/photo.jpg"]


def test_lazy_loaded_images_use_the_real_source():
    html = """
      <img src="/grey.gif" data-src="/real.jpg">
      <img srcset="/small.jpg 400w, /large.jpg 1600w, /mid.jpg 800w">
      <picture><source srcset="/pic.webp 2x"><img src="/pic.jpg"></picture>
    """
    assert photos_in_html(html, PAGE) == [
        "https://example.com/real.jpg",
        "https://example.com/large.jpg",
        "https://example.com/pic.webp",
        "https://example.com/pic.jpg",
    ]


def test_relative_urls_follow_the_base_tag_and_duplicates_are_dropped():
    html = """<base href="https://static.example.org/site/">
      <meta property="og:image" content="img/a.jpg">
      <img src="img/a.jpg"><img src="javascript:alert(1)">"""
    assert photos_in_html(html, PAGE) == ["https://static.example.org/site/img/a.jpg"]


def test_at_most_twelve_photos():
    html = "".join(f'<img src="/p{i}.jpg">' for i in range(30))
    assert len(photos_in_html(html, PAGE)) == link_photos.MAX_PHOTOS


def stub_fetch(monkeypatch, result):
    def fake(url):
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(link_photos, "_fetch", fake)


def test_a_page_with_photos_is_ok(monkeypatch):
    stub_fetch(
        monkeypatch, (PAGE, "html", '<meta property="og:image" content="/a.jpg">')
    )
    assert find_link_photos(PAGE) == LinkPhotos("ok", ["https://example.com/a.jpg"])


def test_a_page_without_photos_is_empty(monkeypatch):
    stub_fetch(monkeypatch, (PAGE, "html", "<p>Hello</p>"))
    assert find_link_photos(PAGE) == LinkPhotos("empty", [])


def test_a_link_straight_to_an_image_is_its_own_photo(monkeypatch):
    stub_fetch(monkeypatch, ("https://example.com/a.jpg", "image", ""))
    assert find_link_photos("example.com/a.jpg") == LinkPhotos(
        "ok", ["https://example.com/a.jpg"]
    )


def test_a_page_that_cant_be_read_is_unreachable(monkeypatch):
    stub_fetch(monkeypatch, link_photos._Unreachable("403"))
    assert find_link_photos(PAGE) == LinkPhotos("unreachable", [])


@pytest.mark.parametrize(
    "link",
    [
        "",
        "   ",
        "javascript:alert(1)",
        "ftp://example.com/x",
        "http://127.0.0.1/",
        "http://169.254.169.254/latest",
    ],
)
def test_unsafe_or_empty_links_are_never_fetched(link):
    # No stub: an unsafe address must be refused before any request.
    assert find_link_photos(link).status == "unreachable"


def test_bare_hosts_get_https(monkeypatch):
    seen = []
    monkeypatch.setattr(
        link_photos, "_fetch", lambda url: seen.append(url) or (url, "html", "")
    )
    find_link_photos("viator.com/tours/1")
    assert seen == ["https://viator.com/tours/1"]


GOOGLE_IMAGE = (
    "https://www.google.com/imgres?imgurl=https%3A%2F%2Fcdn.example.com%2Fbeach.jpg"
    "&imgrefurl=https%3A%2F%2Fexample.com%2Ftours%2Fsnorkel&tbnid=abc&docid=def"
)


def test_a_google_images_link_offers_its_image_then_the_pages_photos(monkeypatch):
    seen = []

    def fake(url):
        seen.append(url)
        return (url, "html", '<meta property="og:image" content="/a.jpg">'
                             '<img src="https://cdn.example.com/beach.jpg">')

    monkeypatch.setattr(link_photos, "_fetch", fake)
    assert find_link_photos(GOOGLE_IMAGE) == LinkPhotos(
        "ok", ["https://cdn.example.com/beach.jpg", "https://example.com/a.jpg"]
    )
    # Google's own page is never fetched, only the one the image was on.
    assert seen == [PAGE]


def test_a_google_images_link_still_offers_its_image_when_the_page_cant_be_read(monkeypatch):
    stub_fetch(monkeypatch, link_photos._Unreachable("403"))
    assert find_link_photos(GOOGLE_IMAGE) == LinkPhotos(
        "ok", ["https://cdn.example.com/beach.jpg"]
    )


@pytest.mark.parametrize(
    "link",
    [
        "google.co.uk/imgres?imgurl=https://cdn.example.com/beach.jpg",
        "https://images.google.fr/imgres?imgurl=https%3A%2F%2Fcdn.example.com%2Fbeach.jpg",
    ],
)
def test_google_images_links_from_any_google_site(monkeypatch, link):
    stub_fetch(monkeypatch, AssertionError("nothing to fetch"))
    assert find_link_photos(link) == LinkPhotos(
        "ok", ["https://cdn.example.com/beach.jpg"]
    )


def test_a_google_redirect_reads_the_page_it_points_at(monkeypatch):
    seen = []
    monkeypatch.setattr(
        link_photos, "_fetch", lambda url: seen.append(url) or (url, "html", "")
    )
    find_link_photos("https://www.google.com/url?q=https://example.com/tours/snorkel&sa=U")
    assert seen == [PAGE]


def test_a_google_images_link_to_a_script_is_refused(monkeypatch):
    stub_fetch(monkeypatch, AssertionError("nothing to fetch"))
    found = find_link_photos("https://www.google.com/imgres?imgurl=javascript:alert(1)")
    assert found == LinkPhotos("unreachable", [])


def test_other_google_pages_are_read_like_any_page(monkeypatch):
    seen = []
    monkeypatch.setattr(
        link_photos, "_fetch", lambda url: seen.append(url) or (url, "html", "")
    )
    find_link_photos("https://www.google.com/maps/place/Eiffel+Tower")
    find_link_photos("https://notgoogle.com/imgres?imgurl=https://x.com/a.jpg")
    assert seen == [
        "https://www.google.com/maps/place/Eiffel+Tower",
        "https://notgoogle.com/imgres?imgurl=https://x.com/a.jpg",
    ]


def test_the_endpoint_returns_the_photos(client, trip, monkeypatch):
    stub_fetch(
        monkeypatch, (PAGE, "html", '<meta property="og:image" content="/a.jpg">')
    )
    res = client.get(
        f"/api/trips/{trip.id}/link-photos",
        params={"url": PAGE},
        headers=as_user("jae@example.com"),
    )
    assert res.status_code == 200, res.text
    assert res.json() == {"status": "ok", "photos": ["https://example.com/a.jpg"]}


def test_the_endpoint_is_only_for_people_on_the_trip(client, trip, monkeypatch):
    stub_fetch(monkeypatch, (PAGE, "html", ""))
    res = client.get(
        f"/api/trips/{trip.id}/link-photos",
        params={"url": PAGE},
        headers=as_user("stranger@example.com"),
    )
    assert res.status_code == 403
