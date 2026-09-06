// Full-bleed placeholder map surface. Google Maps JS API + a custom pale
// Map ID replaces this layer later (see design_system readme "Map
// provider") — every child here (pins, routes, floating controls) is
// written to survive that swap unchanged.
export default function MapPlaceholder({ height = "100%", children, style, label = "map tiles placeholder" }) {
  return (
    <div
      style={{
        position: "relative",
        height,
        width: "100%",
        background: "var(--pattern-map)",
        overflow: "hidden",
        ...style,
      }}
    >
      {children}
      {label ? (
        <span
          className="mono-data-sm"
          style={{ position: "absolute", bottom: 8, right: 10, color: "#9a98a3" }}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}
