import { useCallback, useMemo } from "react";
import { markerElement, useMarkers } from "./useMarkers";
import { DOT_SIZE, HIGHLIGHTED_DOT_SIZE as HIGHLIGHTED_SIZE, PHOTO_MARKER_SIZE as PHOTO_SIZE } from "./markerSizes";

/**
 * Ideas with an exact spot, as dots on the surrounding MapCanvas: white
 * like the Compare map's quiet pins, plum for the highlighted one. A
 * highlighted idea with a photo shows the photo in a plum ring instead,
 * so it's easy to find again after panning away.
 *
 *   pins           [{ id, title, lat, lng, photoUrl? }]
 *   highlightedId  drawn larger, in plum (just added, or selected)
 *   hidesLabels    hide Google's labels under the dots (the Map tab)
 *   onTap(pin)
 */
export default function PinDots({ pins, highlightedId = null, hidesLabels = false, onTap }) {
  const items = useMemo(
    () =>
      pins.map((p) => {
        const on = p.id === highlightedId;
        return { key: p.id, id: p.id, title: p.title, lat: p.lat, lng: p.lng, on, photoUrl: on ? p.photoUrl : null, hidesLabels, zIndex: on ? 3 : 2 };
      }),
    [pins, highlightedId, hidesLabels]
  );
  const tap = useCallback((item) => onTap?.(pins.find((p) => p.id === item.id)), [onTap, pins]);
  useMarkers(items, dotElement, onTap ? tap : undefined);
  return null;
}

const QUIET = ["background:#fff", "border:2px solid rgba(27,26,31,.35)", "box-shadow:var(--shadow-pin-quiet)"];
const PLUM = ["background:var(--accent)", "border:2.5px solid #fff", "box-shadow:var(--shadow-pin)"];

function dotElement({ on, photoUrl }) {
  if (on && photoUrl) return photoElement(photoUrl);
  const size = on ? HIGHLIGHTED_SIZE : DOT_SIZE;
  return markerElement("", [`width:${size}px`, `height:${size}px`, "border-radius:50%", "box-sizing:border-box", ...(on ? PLUM : QUIET)]);
}

// The photo is hotlinked or a short-lived signed URL, so it can fail to
// load: then it quietly becomes the plum dot it would otherwise have been.
function photoElement(photoUrl) {
  const el = markerElement("", [
    `width:${PHOTO_SIZE}px`,
    `height:${PHOTO_SIZE}px`,
    "border-radius:50%",
    "box-sizing:border-box",
    "overflow:hidden",
    "border:3px solid var(--accent)",
    "background:var(--pattern-photo)",
    "box-shadow:0 0 0 2px #fff, var(--shadow-pin)",
  ]);
  const img = document.createElement("img");
  img.src = photoUrl;
  img.alt = "";
  img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block";
  img.addEventListener("error", () => {
    img.remove();
    el.style.cssText = [`width:${HIGHLIGHTED_SIZE}px`, `height:${HIGHLIGHTED_SIZE}px`, "border-radius:50%", "box-sizing:border-box", ...PLUM].join(";");
  });
  el.append(img);
  return el;
}
