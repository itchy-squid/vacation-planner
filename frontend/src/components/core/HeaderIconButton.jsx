// A header glyph with no border and no fill, and a 44px touch target all
// the same (--hit-min, "never smaller, per platform minimum" — see
// styles/tokens/spacing.css). The two are deliberately different numbers:
// the button reads as just the glyph, but a thumb hits a square nearly
// twice the glyph's size.
//
// Its own file rather than a second export from TripHeader.jsx so that
// SettingsButton (which TripHeader renders) can use it without the two
// importing each other.
export default function HeaderIconButton({ glyph, label, onClick, glyphSize = 18, style }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="tap hit-target"
      onClick={onClick}
      style={{
        width: "var(--hit-min)",
        height: "var(--hit-min)",
        background: "none",
        border: "none",
        padding: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        font: `400 ${glyphSize}px var(--font-sans)`,
        lineHeight: 1,
        color: "var(--text-primary)",
        flex: "none",
        cursor: "pointer",
        ...style,
      }}
    >
      {glyph}
    </button>
  );
}
