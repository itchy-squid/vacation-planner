# Pin photos — pick from the link, Google Maps, or your own

Today a pin's photo can only be set by pasting a direct image URL
(**Replace** on `pages/EditVisit.jsx`). This spec replaces that with a
picker that offers photos from three places, and always lets the person
add their own or go without.

## Why the first attempt failed

An earlier version of the new-pin form (removed in `06c26e6`) fetched the
pasted link's page server-side and offered photos scraped from its HTML.
Many pages don't ship their photos in the raw HTML: bot walls, and sites
that load images with JavaScript after the page opens. The scrape came
back thin or wrong often enough that it was dropped for a paste-a-URL
field.

The scrape itself was never the real problem: it was the **only** source,
so every empty result was a dead end. In this design it is one source of
three, and the picker always offers a way forward:

```
┌ Photo ──────────────────────────────┐
│ From the link     [img][img][img]   │  ← may be empty / "couldn't read"
│ From Google Maps  [img][img][img]   │  ← only for pins with a Google place
│ [ Upload your own ]   [ No photo ]  │  ← always there
└─────────────────────────────────────┘
```

An empty row says so in a line ("Nothing found on that page") and the rest
of the picker is unaffected.

## The picker

One shared component, `components/photos/PhotoPicker.jsx`, used in:

- **Add by hand** (`components/newpin/ByHandForm.jsx`), once a link is pasted
- **Replace** on the idea's page (`pages/EditVisit.jsx`)
- **Add from search** (`components/newpin/PlaceDetailsForm.jsx`), once
  Google photos exist (phase 3)

Candidates load in the background. Saving a pin never waits on them, and a
tile whose image fails to load in the browser is dropped from the row
rather than shown broken.

## Sources

### 1. From the link (phase 1)

`GET /api/trips/{trip_id}/link-photos?url=…` (needs `ideas:add`) fetches
the page and returns `{ status, photos: [url…] }`, `status` one of:

| status | meaning |
| --- | --- |
| `ok` | at least one candidate |
| `empty` | the page loaded but offered nothing usable |
| `unreachable` | couldn't load it: blocked, timed out, not a web page, or an address the server won't fetch |

Candidates, in this order, deduplicated, at most 12:

1. `og:image` (and `:url`, `:secure_url`), `twitter:image`
2. JSON-LD `image` anywhere in the page's structured data (restaurants,
   hotels, tours and recipes usually carry it)
3. `<link rel="image_src">`
4. `<img>` tags (including `data-src` and `srcset`), skipping ones that
   look like icons, logos, avatars, tracking pixels or SVGs, and ones whose
   declared width or height is under 200px

A link straight to an image is its own single candidate. Every fetch goes
through `net_guard.require_public_http_url` on each redirect hop, reads at
most 2 MB of HTML and gives up after `net_guard.TIMEOUT_SECONDS`.

A link copied from Google Images (`google.com/imgres?imgurl=…&imgrefurl=…`)
is Google's page about the image, not the image: its image comes first, then
the photos on the page it was found on (`imgrefurl`). Google's own page is
never fetched. A Google redirect (`google.com/url?q=…`) reads the page it
points at. **Paste an image link** swaps a Google Images link for its image
too (`lib/googleImageLink.js`).

Some sites (Instagram, TikTok, many booking sites) will always come back
`unreachable` or `empty`. That's expected; the other sources cover them. A
hosted unfurl service that runs a real browser (Microlink, Iframely) would
fix those, at a cost and a third-party dependency. Not planned.

Picking one stores it as `photo_url` with the page as `photo_source_url`;
`routers/pins.py` then mirrors it into blob storage as it already does.

### 2. Upload your own (phase 2)

`POST /api/trips/{trip_id}/photos` (multipart) writes straight to blob
storage through `photo_storage.py`. The type is checked from the file's own
bytes, not its name, against the same allow-list and 15 MB cap the mirror
uses. The browser downscales large photos before sending.

Local dev has no storage account. Open question: save to a local folder,
or hide **Upload** there.

The picker also keeps **Paste an image link** as a fallback, which is
today's behaviour.

### 3. From Google Maps (phase 3)

Requested through the Maps JS `places` library for the pin's
`googlePlaceId`, only when the picker opens (the `photos` field is billed
at a higher tier, which is why place search leaves it out today).

Google's terms don't allow copying their photos into our own storage, and
each photo must show its author attribution. So a Google photo:

- is stored by reference (the photo's resource name) plus its attribution,
  never as a mirrored blob: the background mirror must skip it
- is resolved to a fresh image URL when shown, which is billed per request,
  so resolved URLs are cached briefly
- shows its attribution wherever it's drawn

Open question: whether that's worth it on the board, or only on the idea's
own page.

### 4. No photo

Clears `photo_url`; every surface falls back to the striped placeholder.
Already works.

## Data model (phases 2–3)

- `photo_origin`: `link` | `upload` | `google` | `pasted`. Decides whether
  the photo is mirrored, signed, or resolved through Google.
- `photo_attribution`: JSON, Google's author attributions.

Phase 1 needs neither.

## Phases

1. Link scraper and the picker (link row, paste a link, no photo) in
   **Add by hand** and **Replace**
2. Upload your own
3. Google Maps photos, including **Add from search**
