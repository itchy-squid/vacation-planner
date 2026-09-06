// 2px rotated div between two consecutive selected pins. See design_system
// readme "Map provider — Routes": google.maps.Polyline along Directions API
// results in production; this is the straight-line prototype fallback.
export default function RouteSegment({ from, to, color }) {
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  const length = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (
    <div
      style={{
        position: "absolute",
        left: from.cx,
        top: from.cy,
        width: length,
        height: 2,
        background: color,
        borderRadius: 2,
        transformOrigin: "0 50%",
        transform: `rotate(${angle}deg)`,
        transition: "var(--transition-route)",
        zIndex: 3,
      }}
    />
  );
}
