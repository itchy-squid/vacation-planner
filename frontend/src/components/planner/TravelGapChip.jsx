import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { isMapsConfigured } from "../../lib/googleMaps";
import { estimateLeg } from "../../lib/routeEstimates";
import { clockLabel } from "../../lib/planTime";
import { PX_PER_MIN, topForMinute } from "../../lib/dayGrid";
import { formatMinutes } from "../../lib/travel";

const CHIP_H = 20;

/**
 * The "+ travel" button between two blocks on the day (lib/travel.js
 * travelGaps), centred on the gap, or on the seam when they're back to
 * back. When both ends are ideas on the map it shows Google's drive time,
 * in the warning colour when that's longer than the gap: adding it will
 * push what's after it later.
 */
export default function TravelGapChip({ gap, onOpen }) {
  const drive = useDriveMinutes(gap.from?.point, gap.to?.point);
  const room = gap.endMin - gap.startMin;
  const tight = drive != null && drive > room;
  const tone = tight ? "var(--warn)" : "var(--geo)";
  const mid = topForMinute(gap.startMin) + (room * PX_PER_MIN) / 2;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(gap);
      }}
      aria-label={[
        `Add travel${gap.from ? ` from ${gap.from.label}` : ""}${gap.to ? ` to ${gap.to.label}` : ""} at ${clockLabel(gap.startMin)}`,
        drive != null ? `, about ${formatMinutes(drive)} by car` : "",
        tight ? ", longer than the gap" : "",
      ].join("")}
      style={{
        position: "absolute",
        top: mid - CHIP_H / 2,
        right: 4,
        height: CHIP_H,
        padding: "0 9px",
        borderRadius: CHIP_H / 2,
        border: `1px dashed ${tone}`,
        background: "var(--surface-card)",
        color: tone,
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        font: "600 10.5px var(--font-sans)",
        // Over the blocks' edges when they're back to back.
        zIndex: 2,
      }}
    >
      <FontAwesomeIcon icon={faPlus} style={{ width: 8, height: 8 }} />
      travel
      {drive != null && <span style={{ font: "400 10px var(--font-mono)", color: tight ? tone : "var(--text-muted)" }}>~{formatMinutes(drive)}</span>}
    </button>
  );
}

// Google's drive time between two spots, in minutes; null until it
// answers, or when it can't (lib/routeEstimates.js remembers answers, so
// the Travel form opened from here doesn't ask again).
function useDriveMinutes(from, to) {
  const [minutes, setMinutes] = useState(null);
  const key = from && to ? [from.lat, from.lng, to.lat, to.lng].join(",") : "";
  useEffect(() => {
    setMinutes(null);
    if (!isMapsConfigured || !key) return undefined;
    let live = true;
    estimateLeg(from, to, "car")
      .then((r) => live && r.available && setMinutes(r.minutes))
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return minutes;
}
