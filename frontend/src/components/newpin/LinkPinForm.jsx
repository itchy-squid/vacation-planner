import { useState } from "react";
import TextField from "../forms/TextField";
import Button from "../core/Button";
import PhotoPlaceholder from "../core/PhotoPlaceholder";
import { BOARD_PHOTO_HEIGHT_PRIMARY } from "../planner/PinCard";
import { NewPinHeader, AddModeSwitch } from "./NewPinChrome";
import { externalHref } from "../../lib/externalHref";

// Best-effort "give this pin a name" when someone pastes a link and
// doesn't bother typing a title — mirrors how bookmarking tools fall back
// to a link's hostname. Never throws: a link that doesn't parse as a URL
// just falls back to the raw text.
function deriveTitleFromLink(link) {
  if (!link) return null;
  const href = externalHref(link);
  if (!href) return link;
  const host = new window.URL(href).hostname.replace(/^www\./, "");
  return host || link;
}

// Adding a pin by hand: paste a link (Instagram, an article, a place
// Google doesn't know) and/or type a name. The way every pin was added
// before place search (pages/NewPin.jsx), and still the route when
// there's no Maps key.
//
// Earlier this form tried to read the pasted link's own page server-side
// (title + a picker of candidate photos scraped from its markup). That
// depended on the linked page actually shipping its content in the raw
// HTML a plain server-side fetch receives — plenty of real pages (bot
// walls, or content a site injects via JavaScript after load) simply
// don't, so the scrape came back thin or wrong often enough that it
// wasn't worth the round trip. The person pastes the title, the page
// link, and (optionally) a direct link to the photo itself, by hand.
//
//   focusTitle    start in the title (the empty board's "Type a place"
//                 without a Maps key) rather than the link
//   onSearch      switch to place search; absent without a Maps key
//   onSubmit(payload)  the POST /api/trips/{id}/pins body
export default function LinkPinForm({ knownRegions, focusTitle, submitting, error, onCancel, onSearch, onSubmit }) {
  const [link, setLink] = useState("");
  const [imageLink, setImageLink] = useState("");
  const [title, setTitle] = useState("");
  const [place, setPlace] = useState("");
  const [region, setRegion] = useState("");

  const canSubmit = (link.trim().length > 0 || title.trim().length > 0) && !submitting;

  function submit(e) {
    e?.preventDefault();
    if (!canSubmit) return;
    const finalTitle = title.trim() || deriveTitleFromLink(link.trim()) || "Untitled pin";
    const trimmedImage = imageLink.trim();
    onSubmit({
      title: finalTitle,
      short: finalTitle.length > 28 ? `${finalTitle.slice(0, 27)}…` : finalTitle,
      place: place.trim() || finalTitle,
      region: region.trim(),
      link: link.trim(),
      notes: "",
      tags: [],
      photo_url: trimmedImage || null,
      // Kept alongside the photo so the pin can credit and link back to
      // where it came from — the page link when there's one, otherwise
      // just the image's own URL.
      photo_source_url: trimmedImage ? link.trim() || trimmedImage : null,
    });
  }

  return (
    <div className="screen">
      <div className="screen-scroll" style={{ paddingBottom: 24 }}>
        <NewPinHeader
          backLabel="Cancel"
          onBack={onCancel}
          action={
            <button type="button" onClick={submit} disabled={!canSubmit} style={{ font: "600 13px var(--font-sans)", color: canSubmit ? "var(--text-primary)" : "var(--text-muted)" }}>
              {submitting ? "Adding…" : "Add"}
            </button>
          }
        />
        {onSearch ? <AddModeSwitch mode="link" onSearch={onSearch} /> : null}

        <form onSubmit={submit} style={{ padding: onSearch ? "0 16px" : "16px 16px 0", display: "flex", flexDirection: "column", gap: 14 }}>
          <TextField
            label="Link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Paste a link — maps, Instagram, an article…"
            mono
            size={12.5}
            autoFocus={!focusTitle}
          />

          <div>
            <TextField
              label="Image link"
              value={imageLink}
              onChange={(e) => setImageLink(e.target.value)}
              placeholder="Paste a photo URL (optional)"
              mono
              size={12.5}
            />
            {/* Live preview only — nothing is fetched or validated until
                the pin is saved. A link that doesn't actually point at an
                image just falls back to the striped placeholder texture
                (see PhotoPlaceholder's own onError handling). */}
            {imageLink.trim() ? (
              <div style={{ marginTop: 8 }}>
                <PhotoPlaceholder height={BOARD_PHOTO_HEIGHT_PRIMARY} label="Couldn’t load that image" src={imageLink.trim()} alt={title || "Pin photo"} />
              </div>
            ) : null}
          </div>

          <TextField
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={deriveTitleFromLink(link.trim()) || "e.g. Vase Rock"}
            weight={600}
            size={15}
            autoFocus={focusTitle}
          />
          <TextField label="Place" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="e.g. Xiaoliuqiu, Pingtung" />
          <div>
            <TextField label="Region" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="e.g. Xiaoliuqiu" list="known-regions" />
            {knownRegions.length ? (
              <datalist id="known-regions">
                {knownRegions.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            ) : null}
          </div>

          {error ? <div style={{ font: "500 12.5px var(--font-sans)", color: "#b3423a" }}>{error}</div> : null}

          <Button variant="primary" type="submit" disabled={!canSubmit} style={{ marginTop: 4 }}>
            {submitting ? "Adding…" : "Add to board"}
          </Button>
          <div style={{ textAlign: "center", font: "400 11px var(--font-sans)", color: "var(--text-muted)", paddingBottom: 8 }}>
            You’ll set duration, cost, and notes next.
          </div>
        </form>
      </div>
    </div>
  );
}
