// The map-pin mark: whether an idea has an exact spot on the map. A solid
// pin in the pin colour (--pin, used for nothing else) when it has one; a
// hollow, crossed-out pin when it only knows its region, so it shows on the
// map as a count in that region's area and gets no ride on the plan.
// Used on the Ideas board's badges, calendar blocks and the Itinerary.
// `color` / `dot` override the fill and the centre dot, for the white pin
// on the board's filled badge.
export default function PinMark({ spotted, size = 10, color = "var(--pin)", dot = "#fff", title }) {
  const height = (size * 16) / 12;
  const outline = "M6 .8C3.1.8.8 3.1.8 5.9c0 3.9 5.2 9.2 5.2 9.2s5.2-5.3 5.2-9.2C11.2 3.1 8.9.8 6 .8z";
  return (
    <svg
      viewBox="0 0 12 16"
      width={size}
      height={height}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : "true"}
      style={{ flex: "none", display: "block" }}
    >
      {spotted ? (
        <>
          <path d={outline} fill={color} />
          <circle cx="6" cy="6" r="2" fill={dot} />
        </>
      ) : (
        <>
          <path d={outline} fill="none" stroke="var(--text-muted)" strokeWidth="1.5" />
          <line x1="1.5" y1="14" x2="10.5" y2="1.5" stroke="var(--text-muted)" strokeWidth="1.5" />
        </>
      )}
    </svg>
  );
}

