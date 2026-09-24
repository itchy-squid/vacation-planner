import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faAnglesDown, faAnglesUp, faLock } from "@fortawesome/free-solid-svg-icons";
import { clockLabel } from "../../lib/planTime";

// Renders one Plan absolutely positioned on the DaySchedule calendar grid
// — replaces TimeBlock.jsx, whose heights were a duration heuristic
// (blockHeight()) rather than true minute-to-pixel positioning. The
// caller (pages/DaySchedule.jsx) computes top/height/left/width (it needs
// sibling plans to lay out side-by-side columns for overlapping/contested
// plans) and passes them in via `rect`; this component only renders the
// plan's own content for each status. See docs/features/scheduling-
// feature-spec.md "Calendar grid" + "Plan.status".
// `continuesBefore` / `continuesAfter` mark a plan that crosses midnight,
// drawn on each day it touches: the rectangle is clipped to the grid by
// the caller, and the squared-off edge plus a double-chevron says the
// block runs on past it. The chevron rides inline with the title for the
// same reason the lock does — a compact block (under ~34px, so under 34
// minutes on this day) hides the subtitle entirely, and the tail end of
// an overnight plan is exactly the case that can be a few minutes long.
// The times in the subtitle are always the plan's real start and end, not
// the clipped ones, so a 22:00–10:00 crossing reads "22:00–10:00" on both
// days rather than lying about where it stops.
function ContinuationMark({ icon, color }) {
  return <FontAwesomeIcon icon={icon} style={{ width: 8, height: 8, flexShrink: 0, opacity: 0.75, color }} />;
}

// Who a plan is for, when it isn't everyone (lib/splits.js): the faces of
// the people going, riding at the end of the title row so even a compact
// block says whose it is. A plan for everyone draws nothing — that's the
// common case, and a row of six faces on every block would say nothing.
//
// `tight` is for a block squeezed into a third of the grid or less (a
// vote inside one group of a split day): there the faces would take the
// whole title, so one face stands in with a count beside it.
//
// `newcomers` marks the group anyone added to the trip later will join
// (SplitBranch.takes_newcomers) with a small + after the faces.
function Faces({ people, tight = false, newcomers = false }) {
  if (!people?.length) return null;
  const shown = people.slice(0, tight ? 1 : 3);
  const more = people.length - shown.length;
  return (
    <span
      aria-label={`For ${people.map((p) => p.name).join(", ")}`}
      title={people.map((p) => p.name).join(", ")}
      style={{ display: "inline-flex", alignItems: "center", flex: "none", marginLeft: "auto", paddingLeft: 4 }}
    >
      {shown.map((p, i) => (
        <span
          key={p.id}
          style={{
            width: 15,
            height: 15,
            borderRadius: "50%",
            background: p.tint,
            border: "1.5px solid var(--surface-card)",
            marginLeft: i === 0 ? 0 : -5,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            font: "600 8px var(--font-sans)",
            color: "var(--text-secondary)",
          }}
        >
          {p.initial}
        </span>
      ))}
      {more > 0 && (
        <span className="mono-data-sm" style={{ marginLeft: 3, color: "var(--text-secondary)", fontSize: 9 }}>
          +{more}
        </span>
      )}
      {newcomers && (
        <span
          className="mono-data-sm"
          title="Anyone added to the trip later joins this group"
          style={{ marginLeft: 3, color: "var(--accent)", fontSize: 9, letterSpacing: "0.04em" }}
        >
          {tight ? "+" : "+NEW"}
        </span>
      )}
    </span>
  );
}

export default function PlanBlock({ plan, rect, onTap, continuesBefore = false, continuesAfter = false, faces = null, tightFaces = false, newcomers = false }) {
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

  // A clipped edge is square: a rounded one would read as the block
  // ending there, which is the one thing it must not say.
  const clipRadius = {
    borderTopLeftRadius: continuesBefore ? 0 : undefined,
    borderTopRightRadius: continuesBefore ? 0 : undefined,
    borderBottomLeftRadius: continuesAfter ? 0 : undefined,
    borderBottomRightRadius: continuesAfter ? 0 : undefined,
  };

  if (plan.status === "contested") {
    return (
      <div
        className="tap"
        onClick={onTap}
        style={{
          ...base,
          borderRadius: "var(--radius-md)",
          ...clipRadius,
          border: "2px dashed var(--accent)",
          background: "var(--plum-tint)",
          padding: compact ? "3px 7px" : "6px 8px",
          transition: `background var(--dur-base) var(--ease-standard)`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 4, font: "600 11.5px var(--font-sans)", color: "var(--accent)", overflow: "hidden" }}>
          {continuesBefore && <ContinuationMark icon={faAnglesUp} color="var(--accent)" />}
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
          {continuesAfter && <ContinuationMark icon={faAnglesDown} color="var(--accent)" />}
          <Faces people={faces} tight={tightFaces} newcomers={newcomers} />
        </div>
        {!compact && (
          <div className="mono-data-sm" style={{ color: "var(--text-secondary)", marginTop: 2 }}>
            {/* "proposed", though the status is `contested`. The status
                names the slot's situation; this label names the block the
                reader is looking at, and a lone proposal on an empty
                afternoon is not in a fight with anything — a contest is
                legal with a single option and no incumbent (proposals
                spec §6.2). Where there really are several, the grid packs
                them into side-by-side columns, so the competition is
                visible without a word for it. */}
            {startLabel}–{endLabel} · proposed
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
          ...clipRadius,
          background: "var(--surface-page)",
          borderLeft: "3px solid var(--accent)",
          padding: compact ? "3px 7px" : "6px 8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 4, font: "600 12px var(--font-sans)", color: "var(--text-primary)", overflow: "hidden" }}>
          {continuesBefore && <ContinuationMark icon={faAnglesUp} color="var(--text-secondary)" />}
          {/* Font Awesome Free's solid lock — flat, monochrome (fill:
              currentColor, no color of its own), rides inline with the
              title rather than only in the subtitle below, because
              compact blocks (rect.height < 34, any stop under ~45min)
              hide that subtitle entirely — without this a short locked
              plan would render indistinguishably from an unlocked one.
              Same icon as the lock toggle in PlanDetailsSheet.jsx. */}
          <FontAwesomeIcon icon={faLock} style={{ width: 9, height: 9, flexShrink: 0 }} />
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
          {continuesAfter && <ContinuationMark icon={faAnglesDown} color="var(--text-secondary)" />}
          <Faces people={faces} tight={tightFaces} newcomers={newcomers} />
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
        ...clipRadius,
        background: isPencilled ? "var(--surface-page)" : "var(--teal-50)",
        borderLeft: `3px solid ${isPencilled ? "var(--stone-250)" : "var(--geo)"}`,
        padding: compact ? "3px 7px" : "6px 8px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 4, font: "600 11.5px var(--font-sans)", color: isPencilled ? "var(--text-secondary)" : "var(--text-primary)", overflow: "hidden" }}>
        {continuesBefore && <ContinuationMark icon={faAnglesUp} color="var(--text-secondary)" />}
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
        {continuesAfter && <ContinuationMark icon={faAnglesDown} color="var(--text-secondary)" />}
        <Faces people={faces} tight={tightFaces} newcomers={newcomers} />
      </div>
      {!compact && (
        <div className="mono-data-sm" style={{ color: "var(--text-secondary)", marginTop: 2 }}>
          {startLabel}–{endLabel}{isPencilled ? " · unconfirmed" : ""}
        </div>
      )}
    </div>
  );
}
