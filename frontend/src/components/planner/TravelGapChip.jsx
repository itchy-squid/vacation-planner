import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { useTravelEstimate } from "./useTravelEstimate";
import { clockLabel } from "../../lib/planTime";
import { PX_PER_MIN, topForMinute } from "../../lib/dayGrid";
import { formatMinutes } from "../../lib/travel";

const CHIP_H = 20;

/**
 * The "+ travel" button where travel could go on the day (lib/travel.js
 * travelGaps): centred on a gap between two blocks, or on the seam when
 * they're back to back; just above the first block, from last night's
 * stay; just below the last, to tonight's. It shows Google's drive time
 * (useTravelEstimate.js, typed ends like "MCO" looked up near `bias`), in
 * the warning colour when that's longer than the gap: adding it will push
 * what's after it later.
 */
export default function TravelGapChip({ gap, bias, onOpen }) {
  const ask = useTravelEstimate({
    mode: "car",
    from: { label: gap.from?.label ?? "", point: gap.from?.point ?? null },
    to: { label: gap.to?.label ?? "", point: gap.to?.point ?? null },
    bias,
  });
  const drive = ask.status === "ready" && ask.estimate.available ? ask.estimate.minutes : null;
  const room = gap.endMin - gap.startMin;
  const tight = !gap.edge && drive != null && drive > room;
  const tone = tight ? "var(--warn)" : "var(--geo)";
  const top =
    gap.edge === "start"
      ? topForMinute(gap.startMin) - CHIP_H - 3
      : gap.edge === "end"
        ? topForMinute(gap.startMin) + 3
        : topForMinute(gap.startMin) + (room * PX_PER_MIN) / 2 - CHIP_H / 2;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(gap);
      }}
      aria-label={[
        `Add travel${gap.from ? ` from ${gap.from.label}` : ""}${gap.to ? ` to ${gap.to.label}` : ""} ${gap.edge === "start" ? "arriving at" : "at"} ${clockLabel(gap.startMin)}`,
        drive != null ? `, about ${formatMinutes(drive)} by car` : "",
        tight ? ", longer than the gap" : "",
      ].join("")}
      style={{
        position: "absolute",
        top: Math.max(0, top),
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
      {/* Nothing on the far side of an edge chip shows where it goes. */}
      {gap.edge && (
        <span style={{ fontWeight: 500, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {gap.edge === "end" ? `to ${gap.to.label}` : `from ${gap.from.label}`}
        </span>
      )}
      {drive != null && <span style={{ font: "400 10px var(--font-mono)", color: tight ? tone : "var(--text-muted)" }}>~{formatMinutes(drive)}</span>}
    </button>
  );
}
