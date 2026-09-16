import { useState } from "react";
import { useNavigate } from "react-router-dom";
import TextField from "../components/forms/TextField";
import Button from "../components/core/Button";
import HomeButton from "../components/core/HomeButton";
import PhotoPlaceholder from "../components/core/PhotoPlaceholder";
import { BOARD_PHOTO_HEIGHT_PRIMARY } from "../components/planner/PinCard";
import { usePlannerState, usePlannerDispatch } from "../state/PlannerContext";

// Best-effort "give this pin a name" when someone pastes a link and
// doesn't bother typing a title — mirrors how bookmarking tools fall back
// to a link's hostname. Never throws: a link that doesn't parse as a URL
// just falls back to the raw text.
function deriveTitleFromLink(link) {
  if (!link) return null;
  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(link) ? link : `https://${link}`;
    const host = new window.URL(withProtocol).hostname.replace(/^www\./, "");
    return host || link;
  } catch {
    return link;
  }
}

// Not one of the handoff README's numbered screens. Screen 2 (PinBoard)
// only draws the masonry of already-collected pins.
//
// Earlier this form tried to read the pasted link's own page server-side
// (title + a picker of candidate photos scraped from its markup). That
// depended on the linked page actually shipping its content in the raw
// HTML a plain server-side fetch receives — plenty of real pages (bot
// walls, or content a site injects via JavaScript after load, like a
// dining page whose photos load from a separate client-side call) simply
// don't, so the scrape came back thin or wrong often enough that it
// wasn't worth the round trip. This is the simpler replacement: the
// person pastes the title, the page link, and (optionally) a direct link
// to the photo itself, all by hand.
export default function NewPin() {
  const navigate = useNavigate();
  const dispatch = usePlannerDispatch();
  const { pins, trip } = usePlannerState();

  const knownRegions = [...new Set(Object.values(pins).map((p) => p.region).filter(Boolean))];

  const [link, setLink] = useState("");
  const [imageLink, setImageLink] = useState("");
  const [title, setTitle] = useState("");
  const [place, setPlace] = useState("");
  const [region, setRegion] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const canSubmit = (link.trim().length > 0 || title.trim().length > 0) && !submitting;

  async function handleCreate() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const finalTitle = title.trim() || deriveTitleFromLink(link.trim()) || "Untitled pin";
      const trimmedImage = imageLink.trim();
      const pin = await dispatch({
        type: "CREATE_PIN",
        payload: {
          title: finalTitle,
          short: finalTitle.length > 28 ? `${finalTitle.slice(0, 27)}…` : finalTitle,
          place: place.trim() || finalTitle,
          region: region.trim(),
          link: link.trim(),
          notes: "",
          tags: [],
          photo_url: trimmedImage || null,
          // Kept alongside the photo so the pin can credit and link back
          // to where it came from — the page link when there's one,
          // otherwise just the image's own URL.
          photo_source_url: trimmedImage ? link.trim() || trimmedImage : null,
        },
      });
      navigate(`/trips/${trip.id}/edit/${pin.id}?from=board`);
    } catch (err) {
      setError(err.message || "Couldn't add that pin. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="screen">
      <div className="screen-scroll" style={{ paddingBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 16px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <HomeButton size={28} />
            <button onClick={() => navigate(`/trips/${trip.id}/board`)} style={{ font: "500 13px var(--font-sans)", color: "var(--accent)" }}>‹ Cancel</button>
          </div>
          <span className="mono-caption">New pin</span>
          <button
            onClick={handleCreate}
            disabled={!canSubmit}
            style={{ font: "600 13px var(--font-sans)", color: canSubmit ? "var(--text-primary)" : "var(--text-muted)" }}
          >
            {submitting ? "Adding…" : "Add"}
          </button>
        </div>

        <div style={{ padding: "16px 16px 0", display: "flex", flexDirection: "column", gap: 14 }}>
          <TextField
            label="Link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Paste a link — maps, Instagram, an article…"
            mono
            size={12.5}
            autoFocus
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
                (see PhotoPlaceholder's own onError handling), the same
                way it would anywhere else a pin's photo is drawn. */}
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
          />
          <TextField
            label="Place"
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            placeholder="e.g. Xiaoliuqiu, Pingtung"
          />
          <div>
            <TextField
              label="Region"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="e.g. Xiaoliuqiu"
              list="known-regions"
            />
            {knownRegions.length ? (
              <datalist id="known-regions">
                {knownRegions.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            ) : null}
          </div>

          {error ? (
            <div style={{ font: "500 12.5px var(--font-sans)", color: "#b3423a" }}>{error}</div>
          ) : null}

          <Button variant="primary" onClick={handleCreate} disabled={!canSubmit} style={{ marginTop: 4 }}>
            {submitting ? "Adding…" : "Add to board"}
          </Button>
          <div style={{ textAlign: "center", font: "400 11px var(--font-sans)", color: "var(--text-muted)", paddingBottom: 8 }}>
            You’ll set duration, cost, and notes next.
          </div>
        </div>
      </div>
    </div>
  );
}
