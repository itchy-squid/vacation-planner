import { useEffect, useState } from "react";
import TextField from "../forms/TextField";
import { api } from "../../lib/api";
import { externalHref } from "../../lib/externalHref";
import { googleImageLink, isGoogleMapsLink } from "../../lib/googleImageLink";
import { placePhotos } from "../../lib/placePhotos";
import { isMapsConfigured } from "../../lib/googleMaps";
import PhotoCredit from "./PhotoCredit";
import { GOOGLE_REFERRER_POLICY } from "./usePinPhoto";

// Wait for the link to stop changing before reading its page: typing or
// pasting in pieces shouldn't fetch every prefix.
const LOOKUP_DELAY_MS = 600;
const TILE = 84;

/**
 * Choosing an idea's photo (docs/features/pin-photos-spec.md): its Google
 * place's own photos, photos found on the page its link points at, a
 * pasted image link, or none. Either row can come back empty or
 * unreadable; that's said in a line and the rest of the picker works the
 * same.
 *
 *   tripId        the trip, for the link lookup
 *   link          the idea's link as typed; looked up when it changes. A
 *                 Google Maps link isn't: its page's only image is a map.
 *   placeId       the idea's Google place, if it has one, for its photos
 *   photoUrl      the chosen link photo ("" for none)
 *   googleIndex   the chosen Google photo (its position), or null
 *   current       the link photo the idea already had, offered so it can
 *                 be picked again; absent when adding
 *   onPick(photoUrl, photoSourceUrl, origin, googleIndex)
 *                 photoSourceUrl is the page the photo came from (the link),
 *                 or the image itself when it was pasted with no link;
 *                 undefined when `current` is picked again, so the caller
 *                 keeps the source it already had. origin is "google",
 *                 "link", "pasted", "current" or "none"; googleIndex is
 *                 set only for "google", which has no photoUrl: the image
 *                 is looked up each time it's shown (usePinPhoto.js).
 */
export default function PhotoPicker({ tripId, link, placeId = null, photoUrl, googleIndex = null, current = "", onPick }) {
  const href = isGoogleMapsLink(link) ? null : externalHref(link);
  // Without Maps set up in this build there's nothing to ask Google with.
  const google = useGooglePhotos(isMapsConfigured ? placeId : null);
  const [found, setFound] = useState(null); // { href, status, photos } | null while looking
  // Candidates the browser couldn't load (hotlink-blocked, gone, not an
  // image) are dropped rather than shown broken.
  const [broken, setBroken] = useState(() => new Set());
  const [pasting, setPasting] = useState(false);

  useEffect(() => {
    setFound(null);
    if (!href) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .linkPhotos(tripId, href)
        .then((result) => !cancelled && setFound({ href, ...result }))
        .catch(() => !cancelled && setFound({ href, status: "unreachable", photos: [] }));
    }, LOOKUP_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tripId, href]);

  const fromLink = (found?.photos ?? []).filter((url) => !broken.has(url));
  const tiles = [
    ...(current && !fromLink.includes(current) ? [{ url: current, label: "Current" }] : []),
    ...fromLink.map((url) => ({ url })),
  ];
  const pasted = googleIndex == null && photoUrl && !tiles.some((t) => t.url === photoUrl) ? photoUrl : "";
  const googleTiles = (google?.photos ?? []).map((photo, index) => ({ ...photo, index })).filter((t) => !broken.has(t.src));
  const googleCredit = dedupeCredit(googleTiles.flatMap((t) => t.credit));

  let googleStatus = null;
  if (placeId && isMapsConfigured && !google) googleStatus = "Looking for photos on Google Maps…";
  else if (google?.failed) googleStatus = "Couldn’t load this place’s Google Maps photos.";
  else if (google && googleTiles.length === 0) googleStatus = "Google Maps has no photos of this place.";

  let status = null;
  if (!href) status = isGoogleMapsLink(link) ? null : "Add a link to look for photos on its page.";
  else if (!found) status = "Looking for photos on the page…";
  else if (found.status === "unreachable") status = "Couldn’t read that page. Paste an image link instead, or go without.";
  else if (fromLink.length === 0) status = "No photos found on that page.";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <div className="mono-caption">Photo</div>

      {googleTiles.length ? (
        <div role="radiogroup" aria-label="Photos from Google Maps" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2, minWidth: 0 }}>
          {googleTiles.map((tile) => (
            <Tile
              key={tile.src}
              url={tile.src}
              label={null}
              ariaLabel={`Google Maps photo ${tile.index + 1}`}
              referrerPolicy={GOOGLE_REFERRER_POLICY}
              selected={googleIndex === tile.index}
              onPick={() => {
                setPasting(false);
                onPick("", "", "google", tile.index);
              }}
              onBroken={() => setBroken((prev) => new Set(prev).add(tile.src))}
            />
          ))}
        </div>
      ) : null}
      {googleCredit.length ? <PhotoCredit credit={googleCredit} /> : null}
      {googleStatus ? <Status>{googleStatus}</Status> : null}

      {tiles.length ? (
        <div role="radiogroup" aria-label="Photos" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2, minWidth: 0 }}>
          {tiles.map((tile) => (
            <Tile
              key={tile.url}
              url={tile.url}
              label={tile.label}
              selected={googleIndex == null && photoUrl === tile.url}
              onPick={() => {
                setPasting(false);
                onPick(tile.url, tile.label ? undefined : link.trim(), tile.label ? "current" : "link", null);
              }}
              onBroken={() => setBroken((prev) => new Set(prev).add(tile.url))}
            />
          ))}
        </div>
      ) : null}

      {status ? <Status>{status}</Status> : null}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Chip selected={pasting || Boolean(pasted)} onClick={() => setPasting((open) => !open)}>
          Paste an image link
        </Chip>
        <Chip selected={!photoUrl && googleIndex == null && !pasting} onClick={() => { setPasting(false); onPick("", "", "none", null); }}>
          No photo
        </Chip>
      </div>

      {pasting || pasted ? (
        <TextField
          aria-label="Image link"
          value={pasted}
          onChange={(e) => {
            // A Google Images link is swapped for the image it's about,
            // and the page that image was on stands in for a missing link.
            const fromGoogle = googleImageLink(e.target.value);
            const url = fromGoogle?.image ?? e.target.value;
            onPick(url, url.trim() ? link.trim() || fromGoogle?.page || url.trim() : "", "pasted", null);
          }}
          placeholder="https://…/photo.jpg"
          mono
          size={12.5}
          autoFocus={pasting && !pasted}
        />
      ) : null}
    </div>
  );
}

// A place's Google photos, looked up when the picker opens:
// { placeId, photos } once loaded ({ failed: true } if that failed), null
// while looking or with no place.
function useGooglePhotos(placeId) {
  const [found, setFound] = useState(null);
  useEffect(() => {
    if (!placeId) return undefined;
    let cancelled = false;
    placePhotos(placeId)
      .then((photos) => !cancelled && setFound({ placeId, photos }))
      .catch(() => !cancelled && setFound({ placeId, photos: [], failed: true }));
    return () => {
      cancelled = true;
    };
  }, [placeId]);
  return placeId && found?.placeId === placeId ? found : null;
}

// Each photographer once, for the credit line under the Google row.
function dedupeCredit(credit) {
  const seen = new Set();
  return credit.filter((c) => {
    const key = `${c.name}|${c.uri}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function Status({ children }) {
  return <div style={{ font: "400 12px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>{children}</div>;
}

function Tile({ url, label, ariaLabel, referrerPolicy = "no-referrer", selected, onPick, onBroken }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={ariaLabel ?? (label ? `${label} photo` : "Photo from the link")}
      onClick={onPick}
      style={{
        position: "relative",
        flex: "none",
        width: TILE,
        height: TILE,
        padding: 0,
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        background: "var(--pattern-photo)",
        outline: selected ? "2.5px solid var(--accent)" : "1px solid var(--hairline)",
        outlineOffset: selected ? 1 : 0,
      }}
    >
      <img
        src={url}
        alt=""
        loading="lazy"
        referrerPolicy={referrerPolicy}
        onError={onBroken}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
      {label ? (
        <span
          className="mono-caption"
          style={{ position: "absolute", left: 4, bottom: 4, padding: "1px 5px", borderRadius: 4, background: "rgba(255,255,255,.9)", color: "var(--stone-700)" }}
        >
          {label}
        </span>
      ) : null}
    </button>
  );
}

function Chip({ children, selected, onClick }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      style={{
        padding: "6px 12px",
        borderRadius: "var(--radius-pill)",
        font: "600 12px var(--font-sans)",
        border: `1px solid ${selected ? "var(--text-primary)" : "var(--border-strong)"}`,
        background: selected ? "var(--surface-inverse)" : "var(--surface-card)",
        color: selected ? "#fff" : "var(--text-primary)",
      }}
    >
      {children}
    </button>
  );
}
