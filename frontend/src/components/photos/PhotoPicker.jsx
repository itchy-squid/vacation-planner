import { useEffect, useState } from "react";
import TextField from "../forms/TextField";
import { api } from "../../lib/api";
import { externalHref } from "../../lib/externalHref";

// Wait for the link to stop changing before reading its page: typing or
// pasting in pieces shouldn't fetch every prefix.
const LOOKUP_DELAY_MS = 600;
const TILE = 84;

/**
 * Choosing an idea's photo (docs/features/pin-photos-spec.md): photos
 * found on the page its link points at, a pasted image link, or none.
 * The page row can come back empty or unreadable; that's said in a line
 * and the rest of the picker works the same.
 *
 *   tripId        the trip, for the link lookup
 *   link          the idea's link as typed; looked up when it changes
 *   photoUrl      the chosen photo ("" for none)
 *   current       the photo the idea already had, offered so it can be
 *                 picked again; absent when adding
 *   onPick(photoUrl, photoSourceUrl, origin)
 *                 photoSourceUrl is the page the photo came from (the link),
 *                 or the image itself when it was pasted with no link;
 *                 undefined when `current` is picked again, so the caller
 *                 keeps the source it already had. origin is "link",
 *                 "pasted", "current" or "none".
 */
export default function PhotoPicker({ tripId, link, photoUrl, current = "", onPick }) {
  const href = externalHref(link);
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
  const pasted = photoUrl && !tiles.some((t) => t.url === photoUrl) ? photoUrl : "";

  let status = null;
  if (!href) status = "Add a link to look for photos on its page.";
  else if (!found) status = "Looking for photos on the page…";
  else if (found.status === "unreachable") status = "Couldn’t read that page. Paste an image link instead, or go without.";
  else if (fromLink.length === 0) status = "No photos found on that page.";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <div className="mono-caption">Photo</div>

      {tiles.length ? (
        <div role="radiogroup" aria-label="Photos" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2, minWidth: 0 }}>
          {tiles.map((tile) => (
            <Tile
              key={tile.url}
              url={tile.url}
              label={tile.label}
              selected={photoUrl === tile.url}
              onPick={() => {
                setPasting(false);
                onPick(tile.url, tile.label ? undefined : link.trim(), tile.label ? "current" : "link");
              }}
              onBroken={() => setBroken((prev) => new Set(prev).add(tile.url))}
            />
          ))}
        </div>
      ) : null}

      {status ? <div style={{ font: "400 12px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>{status}</div> : null}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Chip selected={pasting || Boolean(pasted)} onClick={() => setPasting((open) => !open)}>
          Paste an image link
        </Chip>
        <Chip selected={!photoUrl && !pasting} onClick={() => { setPasting(false); onPick("", "", "none"); }}>
          No photo
        </Chip>
      </div>

      {pasting || pasted ? (
        <TextField
          aria-label="Image link"
          value={pasted}
          onChange={(e) => {
            const url = e.target.value;
            onPick(url, url.trim() ? link.trim() || url.trim() : "", "pasted");
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

function Tile({ url, label, selected, onPick, onBroken }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label ? `${label} photo` : "Photo from the link"}
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
        referrerPolicy="no-referrer"
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
