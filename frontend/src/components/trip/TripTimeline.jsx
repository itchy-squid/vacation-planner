import { MIN_VISIT_MIN, VISIT_STEP_MIN, stopLetter } from "../../lib/tripPlan";
import { MODES, MODE_LABELS } from "../../lib/routes";
import { clockLabel } from "../../lib/planTime";
import { formatDuration } from "../../lib/format";
import { formatMoney } from "../../data/expenses";
import ModeIcon from "./ModeIcon";

const ROLE_COLOURS = { new: "var(--accent)", anchor: "var(--geo)", lodging: "var(--surface-inverse)" };

/**
 * The trip as a timeline: each stop with its time and what it is, and the
 * ride to the next stop between them. A ride opens to show every way of
 * making it; a new stop has − / + for how long to stay, and Edit for the
 * rest (its cost, or taking it out). A stop with no place on the map — a
 * custom event — has no ride to it: it happens where the group already is.
 *
 *   trip        buildTrip(...)
 *   dayIndex    the day, for "On Day 3 · 11:00–14:00"
 *   rides       per ride, in order: { estimate, choice, open } —
 *               estimate from useRideEstimates, choice the chosen readRoute()
 *   onStop      { visit(stopId, minutes), remove(index), edit(stop), removable(stop), changeStart() }
 *   onRide      { toggle(index), pick(index, mode), retry() }
 */
export default function TripTimeline({ trip, dayIndex, rides, onStop, onRide, choosingStart }) {
  return (
    <ol aria-label="Trip" style={{ listStyle: "none", display: "flex", flexDirection: "column" }}>
      {trip.seq.map((it) =>
        it.kind === "stop" ? (
          <StopRow
            key={`stop-${it.stop.index}`}
            item={it}
            letter={stopLetter(trip, it.stop)}
            last={it.stop.index === trip.stops.length - 1}
            dayIndex={dayIndex}
            onStop={onStop}
            choosingStart={choosingStart}
          />
        ) : (
          <RideRow key={`ride-${it.index}`} item={it} ride={rides[it.index]} onRide={onRide} />
        )
      )}
    </ol>
  );
}

function costLine(pin) {
  if (!pin.costCents) return "";
  return pin.costBasis === "group" ? ` · ${formatMoney(pin.costCents)} for the group` : ` · ${formatMoney(pin.costCents)} each`;
}

function roleLine(stop, dayIndex, last) {
  if (stop.pin.located === false) {
    const what = stop.pin.travelItemId != null ? "Custom event" : "No map spot";
    return `${what} · where you already are${costLine(stop.pin)}`;
  }
  if (stop.role === "lodging") {
    if (stop.index === 0) return "Where you’re staying · you start here";
    return last ? "Where you’re staying · you end here" : "Where you’re staying";
  }
  if (stop.repeat) return "Passing by again";
  if (stop.role === "anchor") {
    const when = `On Day ${dayIndex} · ${clockLabel(stop.anchor.startMin)}–${clockLabel(stop.anchor.endMin)}`;
    return stop.inBlock ? `${when} · keeps its time` : when;
  }
  return `${last && stop.index > 0 ? "New stop · proposed · ends here" : "New stop · proposed"}${costLine(stop.pin)}`;
}

function StopRow({ item, letter, last, dayIndex, onStop, choosingStart }) {
  const { stop } = item;
  const isNew = stop.role === "new" && !stop.repeat;
  const first = stop.index === 0 && stop.pin.located !== false;
  const placeless = stop.pin.located === false;
  return (
    <li style={{ display: "flex", alignItems: "stretch" }}>
      <Time inBlock={item.inBlock}>{clockLabel(item.start)}</Time>
      <Rail below={!last}>
        <span
          aria-hidden="true"
          style={{
            width: 22,
            height: 22,
            marginTop: 10,
            borderRadius: "50%",
            background: placeless ? "var(--surface-card)" : ROLE_COLOURS[stop.role],
            border: placeless ? "1.5px dashed var(--text-muted)" : "none",
            color: placeless ? "var(--text-secondary)" : "#fff",
            font: "700 11px var(--font-sans)",
            display: "grid",
            placeItems: "center",
            flex: "none",
          }}
        >
          {letter}
        </span>
      </Rail>
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, padding: "8px 0 8px 6px" }}>
        <button
          type="button"
          onClick={first ? onStop.changeStart : undefined}
          disabled={!first}
          aria-pressed={first ? choosingStart : undefined}
          aria-label={first ? `Change where the trip starts: ${stop.pin.title}` : undefined}
          style={{ flex: 1, minWidth: 0, textAlign: "left", display: "flex", flexDirection: "column", gap: 2, cursor: first ? "pointer" : "default", opacity: 1 }}
        >
          <span style={{ font: "600 14px var(--font-sans)", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {stop.pin.title}
          </span>
          <span style={{ font: "400 11.5px var(--font-sans)", color: first && choosingStart ? "var(--accent)" : "var(--text-secondary)" }}>
            {first && choosingStart ? "Tap a place on the map to start there" : roleLine(stop, dayIndex, last)}
          </span>
        </button>
        {isNew && stop.inBlock ? (
          <span style={{ display: "flex", alignItems: "center", gap: 4, flex: "none" }}>
            <MiniButton label={`Shorter at ${stop.pin.title}`} disabled={item.minutes <= MIN_VISIT_MIN} onClick={() => onStop.visit(stop.pin.id, item.minutes - VISIT_STEP_MIN)}>
              −
            </MiniButton>
            <span className="mono-data-sm" style={{ width: 46, textAlign: "center", color: "var(--accent)", letterSpacing: 0 }}>
              {formatDuration(item.minutes)}
            </span>
            <MiniButton label={`Longer at ${stop.pin.title}`} onClick={() => onStop.visit(stop.pin.id, item.minutes + VISIT_STEP_MIN)}>
              +
            </MiniButton>
          </span>
        ) : null}
        {isNew && stop.inBlock ? (
          <button
            type="button"
            aria-label={`Edit ${stop.pin.title}`}
            onClick={() => onStop.edit(stop)}
            style={{ flex: "none", height: 40, padding: "0 4px", font: "600 12px var(--font-sans)", color: "var(--accent)" }}
          >
            Edit
          </button>
        ) : !first && onStop.removable(stop) ? (
          <button type="button" aria-label={`Remove ${stop.pin.title}`} onClick={() => onStop.remove(stop.index)} style={{ flex: "none", width: 32, height: 40, color: "var(--text-muted)", font: "400 16px var(--font-sans)" }}>
            ✕
          </button>
        ) : null}
      </div>
    </li>
  );
}

function RideRow({ item, ride, onRide }) {
  const { estimate, choice, open } = ride;
  const index = item.index;
  let body;
  if (estimate.status === "loading") {
    body = <RideLine>Finding ways to {item.to.title}…</RideLine>;
  } else if (estimate.status === "error") {
    body = (
      <RideLine>
        Couldn’t get times from Google.{" "}
        <button type="button" onClick={onRide.retry} style={{ font: "600 12px var(--font-sans)", color: "var(--accent)" }}>
          Try again
        </button>
      </RideLine>
    );
  } else if (!choice) {
    body = <RideLine>No way to get to {item.to.title} found.</RideLine>;
  } else {
    const nope = MODES.filter((m) => !estimate.byMode[m]?.available).map((m) => `${MODE_LABELS[m]}: ${estimate.byMode[m]?.reason ?? "not available"}`);
    body = (
      <>
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${MODE_LABELS[choice.mode]} to ${item.to.title}, ${formatDuration(choice.minutes)}. Change how`}
          onClick={() => onRide.toggle(index)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "7px 10px",
            minHeight: 44,
            textAlign: "left",
            borderRadius: "var(--radius-md)",
            border: `1px solid ${open ? "var(--accent)" : "var(--border)"}`,
            background: open ? "var(--accent-quiet)" : "var(--surface-card)",
            color: "var(--accent)",
          }}
        >
          <ModeIcon mode={choice.mode} style={{ width: 16 }} />
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ font: "600 13px var(--font-sans)", color: "var(--text-primary)" }}>
              {MODE_LABELS[choice.mode]} · {formatDuration(choice.minutes)}
            </span>
            <span className="mono-data-sm" style={{ color: "var(--text-muted)", letterSpacing: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {choice.summary}
            </span>
          </span>
          {choice.fareCents ? (
            <span className="mono-data-sm" style={{ color: "var(--text-secondary)", letterSpacing: 0 }}>
              ${(choice.fareCents / 100).toFixed(2)} each
            </span>
          ) : null}
        </button>
        {open ? (
          <>
            <div role="group" aria-label={`How to get to ${item.to.title}`} style={{ display: "flex", gap: 6 }}>
              {MODES.map((mode) => {
                const option = estimate.byMode[mode];
                const on = option?.available && mode === choice.mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={Boolean(on)}
                    disabled={!option?.available}
                    title={option?.available ? undefined : option?.reason}
                    aria-label={option?.available ? `${MODE_LABELS[mode]}, ${formatDuration(option.minutes)}` : `${MODE_LABELS[mode]}, not possible: ${option?.reason}`}
                    onClick={() => onRide.pick(index, mode)}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      height: 54,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 3,
                      borderRadius: "var(--radius-md)",
                      border: on ? "1px solid var(--accent)" : option?.available ? "1px solid var(--border-strong)" : "1px dashed var(--border)",
                      background: on ? "var(--accent)" : option?.available ? "var(--surface-card)" : "var(--surface-inset)",
                      color: on ? "#fff" : option?.available ? "var(--text-secondary)" : "var(--text-faint)",
                    }}
                  >
                    <ModeIcon mode={mode} />
                    <span className="mono-data-sm" style={{ letterSpacing: 0, color: "inherit" }}>
                      {option?.available ? formatDuration(option.minutes) : "—"}
                    </span>
                  </button>
                );
              })}
            </div>
            {nope.length ? <RideLine>{nope.join(" · ")}</RideLine> : null}
          </>
        ) : null}
      </>
    );
  }

  return (
    <li style={{ display: "flex", alignItems: "stretch" }}>
      <Time />
      <Rail line />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8, padding: "2px 0 6px 6px" }}>{body}</div>
    </li>
  );
}

function Time({ inBlock = false, children }) {
  return (
    <span className="mono-data-sm" style={{ width: 42, flex: "none", paddingTop: 14, letterSpacing: 0, color: inBlock ? "var(--accent)" : "var(--text-muted)" }}>
      {children}
    </span>
  );
}

function Rail({ children, below = false, line = false }) {
  return (
    <span style={{ width: 28, flex: "none", display: "flex", flexDirection: "column", alignItems: "center" }}>
      {children}
      {below || line ? <span style={{ flex: 1, minHeight: 8, borderLeft: "2px dashed var(--plum-300)" }} /> : null}
    </span>
  );
}

function RideLine({ children }) {
  return <div style={{ font: "400 12px/1.45 var(--font-sans)", color: "var(--text-secondary)", padding: "6px 0" }}>{children}</div>;
}

function MiniButton({ label, disabled = false, onClick, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{ width: 32, height: 32, borderRadius: "50%", border: "1px solid var(--border-strong)", background: "var(--surface-card)", font: "400 16px var(--font-sans)", color: "var(--text-primary)", opacity: disabled ? 0.4 : 1 }}
    >
      {children}
    </button>
  );
}
