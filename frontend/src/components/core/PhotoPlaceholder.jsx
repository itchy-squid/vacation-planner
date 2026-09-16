import { useEffect, useState } from "react";

// Honest placeholder texture, not an error state — see design_system
// readme "Backgrounds and imagery". Photography is intentionally
// unfinished for this pass (real photo-picker flow is not yet designed).
//
// With `src` set it shows a real photo instead: pins can now carry one
// chosen from their link (see pages/NewPin.jsx), and every surface that
// draws a pin already draws it through this component, so the photo
// arrives everywhere at once and keeps the same size and corner
// treatment the placeholder had. Anything without a photo — every pin
// from before that flow, plus anyone who skipped the image — keeps the
// texture, so the two coexist on the same board by design.
export default function PhotoPlaceholder({ height = 112, label = "photo", dark = false, radius, src, alt = "", children }) {
  // A pin's photo is hotlinked from someone else's site, so it can 404,
  // hotlink-block, or go behind a login long after it was picked. Falling
  // back to the texture keeps that a non-event rather than a broken-image
  // icon in the middle of the board.
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const showPhoto = Boolean(src) && !failed;

  return (
    <div
      style={{
        position: "relative",
        height,
        borderRadius: radius,
        overflow: "hidden",
        background: dark ? "var(--pattern-photo-dark)" : "var(--pattern-photo)",
        display: "flex",
        alignItems: "flex-end",
      }}
    >
      {showPhoto ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <span
          className="mono-caption"
          style={{ padding: "0 0 8px 10px", color: dark ? "rgba(255,255,255,.5)" : "var(--text-muted)" }}
        >
          {label}
        </span>
      )}
      {children}
    </div>
  );
}
