// The compare screen's core visual: every competing pin renders on one map,
// only the selected set's pins are large/coloured/numbered/labelled. See
// handoff README screen 5 and design_system readme "Motion". `flipLabel`
// implements "the label flips left of the dot when the pin's x > 230" —
// projected in production to "within ~150px of the map container's right
// edge" per the Google Maps notes.
export default function MapPin({ cx, cy, selected, order, color = "var(--accent)", label, flipLabel = false, onTap }) {
  const size = selected ? 30 : 20;
  return (
    <div
      onClick={onTap}
      className="tap"
      style={{
        position: "absolute",
        left: cx,
        top: cy,
        transform: "translate(-50%, -50%)",
        transition: "var(--transition-pin)",
        zIndex: selected ? 6 : 4,
        cursor: onTap ? "pointer" : undefined,
      }}
    >
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "var(--transition-pin)",
          ...(selected
            ? {
                background: color,
                border: "2.5px solid #fff",
                boxShadow: "var(--shadow-pin)",
                opacity: 1,
              }
            : {
                background: "#fff",
                border: "2px solid rgba(27,26,31,.28)",
                boxShadow: "var(--shadow-pin-quiet)",
                opacity: 0.72,
              }),
        }}
      >
        {selected && order != null ? (
          <span style={{ font: "600 12px var(--font-sans)", color: "#fff" }}>{order}</span>
        ) : null}
      </div>
      {selected && label ? (
        <div
          className="mono-data-sm"
          style={{
            position: "absolute",
            top: "50%",
            transform: `translateY(-50%) ${flipLabel ? "translateX(-100%)" : "translateX(0)"}`,
            [flipLabel ? "right" : "left"]: flipLabel ? size / 2 + 6 : "auto",
            left: flipLabel ? "auto" : size / 2 + 6,
            whiteSpace: "nowrap",
            background: "rgba(255,255,255,.95)",
            borderRadius: 6,
            padding: "3px 6px",
            font: "600 10.5px var(--font-sans)",
            color: "var(--text-primary)",
            boxShadow: "var(--shadow-pin-quiet)",
          }}
        >
          {label}
        </div>
      ) : null}
    </div>
  );
}
