import { useCallback, useMemo } from "react";
import { markerElement, useMarkers } from "./useMarkers";
import { bubbleSize } from "./markerSizes";

/**
 * Ideas too close together to tell apart at this zoom, drawn as one plum
 * bubble with how many there are (laid out by ideaLayout.js): exact spots,
 * plus the ideas of any region badge it would have covered. Solid and
 * round, unlike a region's dashed teal badge; zooming in splits it up.
 *
 *   clusters  [{ key, lat, lng, count }]
 *   onTap(cluster)
 */
export default function ClusterBubbles({ clusters, onTap }) {
  const items = useMemo(
    () =>
      clusters.map((c) => ({
        key: c.key,
        lat: c.lat,
        lng: c.lng,
        count: c.count,
        title: `${c.count} ideas here`,
        hidesLabels: true,
        zIndex: 3,
      })),
    [clusters]
  );
  const tap = useCallback((item) => onTap(clusters.find((c) => c.key === item.key)), [onTap, clusters]);
  useMarkers(items, bubbleElement, tap);
  return null;
}

function bubbleElement({ count }) {
  const size = bubbleSize(count);
  return markerElement(String(count), [
    `width:${size}px`,
    `height:${size}px`,
    "box-sizing:border-box",
    "border-radius:50%",
    "background:var(--accent)",
    "border:2.5px solid #fff",
    "box-shadow:0 0 0 5px var(--plum-tint-strong), var(--shadow-pin)",
    "color:#fff",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "font:700 13px var(--font-sans)",
    "font-variant-numeric:tabular-nums",
  ]);
}
