/**
 * The credit Google requires beside one of a place's photos: where it's
 * from and who took it, linked to their Google Maps profile. Nothing for a
 * photo without one (a link photo). `overlay` draws it over the photo's
 * bottom-left corner; otherwise it's a line of its own.
 */
export default function PhotoCredit({ credit, overlay = false }) {
  if (!credit?.length) return null;
  const names = credit.filter((c) => c.name);
  return (
    <div
      style={{
        font: overlay ? "500 9.5px/1.3 var(--font-sans)" : "400 11px/1.4 var(--font-sans)",
        color: overlay ? "var(--stone-700)" : "var(--text-muted)",
        // At most two lines over a photo, so a long name stays readable on
        // a narrow board card without covering it.
        overflow: "hidden",
        display: "-webkit-box",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: overlay ? 2 : 3,
        ...(overlay ? { position: "absolute", left: 6, bottom: 6, maxWidth: "calc(100% - 12px)", padding: "1px 5px", borderRadius: 4, background: "rgba(255,255,255,.9)" } : {}),
      }}
    >
      Google Maps
      {names.map((c, i) => (
        <span key={`${c.name}-${i}`}>
          {i === 0 ? " · " : ", "}
          {c.uri ? (
            // The credit sits on tappable cards; following it shouldn't
            // also open the card.
            <a href={c.uri} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "inherit", textDecoration: "underline" }}>
              {c.name}
            </a>
          ) : (
            c.name
          )}
        </span>
      ))}
    </div>
  );
}
