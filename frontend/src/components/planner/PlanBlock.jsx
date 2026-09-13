import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLock } from "@fortawesome/free-solid-svg-icons";
import { clockLabel } from "../../lib/planTime";

// Renders one Plan absolutely positioned on the DaySchedule calendar grid
// — replaces TimeBlock.jsx, whose heights were a duration heuristic
// (blockHeight()) rather than true minute-to-pixel positioning. The
// caller (pages/DaySchedule.jsx) computes top/height/left/width (it needs
// sibling plans to lay out side-by-side columns for overlapping/contested
// plans) and passes them in via `rect`; this component only renders the
// plan's own content for each status. See docs/features/scheduling-
// feature-spec.md "Calendar grid" + "Plan.status".
export default function PlanBlock({ plan, rect, onTap }) {
  const title = plan.items.map((i) => i.title).join(" + ") || plan.label || "Untitled";
  const startLabel = plan.startDt ? clockLabel(plan.startDt.minuteOfDay) : "";
  const endLabel = plan.endDt ? clockLabel(plan.endDt.minuteOfDay) : "";
  const compact = rect.height < 34;

  const base = {
    position: "absolute",
    top: rect.top,
    height: Math.max(rect.height, 20),
    left: rect.left,
    width: rect.width,
    cursor: "pointer",
    overflow: "hidden",
    boxSizing: "border-box",
  };

  if (plan.status === "contested") {
    return (
      <div
        className="tap"
        onClick={onTap}
        style={{
          ...base,
          borderRadius: "var(--radius-md)",
          border: "2px dashed var(--accent)",
          background: "var(--plum-tint)",
          padding: compact ? "3px 7px" : "6px 8px",
          transition: `background var(--dur-base) var(--ease-standard)`,
        }}
      >
        <div style={{ font: "600 11.5px var(--font-sans)", color: "var(--accent)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {title}
        </div>
        {!compact && (
          <div className="mono-data-sm" style={{ color: "var(--text-secondary)", marginTop: 2 }}>
            {startLabel}–{endLabel} · contested
          </div>
        )}
      </div>
    );
  }

  if (plan.status === "locked") {
    return (
      <div
        className="tap"
        onClick={onTap}
        style={{
          ...base,
          borderRadius: "var(--radius-md)",
          background: "var(--surface-page)",
          borderLeft: "3px solid var(--accent)",
          padding: compact ? "3px 7px" : "6px 8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 4, font: "600 12px var(--font-sans)", color: "var(--text-primary)", overflow: "hidden" }}>
          {/* Font Awesome Free's solid lock — flat, monochrome (fill:
              currentColor, no color of its own), rides inline with the
              title rather than only in the subtitle below, because
              compact blocks (rect.height < 34, any stop under ~45min)
              hide that subtitle entirely — without this a short locked
              plan would render indistinguishably from an unlocked one.
              Same icon as the lock toggle in PlanDetailsSheet.jsx. */}
          <FontAwesomeIcon icon={faLock} style={{ width: 9, height: 9, flexShrink: 0 }} />
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
        </div>
        {!compact && (
          <div className="mono-data-sm" style={{ color: "var(--text-secondary)", marginTop: 2 }}>
            {startLabel}–{endLabel} · locked
          </div>
        )}
      </div>
    );
  }

  // placed | pencilled
  const isPencilled = plan.status === "pencilled";
  return (
    <div
      className="tap"
      onClick={onTap}
      style={{
        ...base,
        borderRadius: "var(--radius-md)",
        background: isPencilled ? "var(--surface-page)" : "var(--teal-50)",
        borderLeft: `3px solid ${isPencilled ? "var(--stone-250)" : "var(--geo)"}`,
        padding: compact ? "3px 7px" : "6px 8px",
      }}
    >
      <div style={{ font: "600 11.5px var(--font-sans)", color: isPencilled ? "var(--text-secondary)" : "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {title}
      </div>
      {!compact && (
        <div className="mono-data-sm" style={{ color: "var(--text-secondary)", marginTop: 2 }}>
          {startLabel}–{endLabel}{isPencilled ? " · unconfirmed" : ""}
        </div>
      )}
    </div>
  );
}
