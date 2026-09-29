import { describeDay, includesPlace, isSet, placeNames } from "../../lib/dayPlaces";

/**
 * The Plan tab's line above the day title (pages/DaySchedule.jsx): the
 * places set for the day ("Staying in Taipei · Day trip to North Coast"),
 * or, when none are, what the calendar suggests (`fallback`, the old
 * "Scheduling · Taipei"). Planners get Edit / Set places; everyone gets
 * "All days", the whole trip in "Where we'll be".
 */
export function DayPlacesLine({ day, previousStay, fallback, canEdit, onEdit, onAllDays }) {
  const set = isSet(day);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div className="mono-caption" style={{ flex: 1, minWidth: 0, lineHeight: 1.4, color: set ? "var(--geo)" : undefined }}>
        {set ? describeDay(day, previousStay) : fallback}
      </div>
      {canEdit ? (
        <button
          type="button"
          onClick={onEdit}
          style={{
            flex: "none",
            padding: "3px 10px",
            borderRadius: "var(--radius-pill)",
            border: "1px solid var(--border)",
            background: "var(--surface-card)",
            font: "600 11px var(--font-sans)",
            color: "var(--accent)",
          }}
        >
          {set ? "Edit places" : "Set places"}
        </button>
      ) : null}
      {onAllDays ? (
        <button type="button" onClick={onAllDays} style={{ flex: "none", font: "500 11.5px var(--font-sans)", color: "var(--accent)" }}>
          All days ›
        </button>
      ) : null}
    </div>
  );
}

/**
 * On a day with places set, a note for each place on the calendar that
 * isn't one of them ("Jiufen Old Street is in Jiufen, which isn't one of
 * this day's places"), with a one-tap fix for planners. Nothing is blocked.
 */
export function PlacesMismatch({ day, onCalendar, canEdit, onAdd }) {
  if (!isSet(day)) return null;
  const listed = placeNames(day);
  const seen = new Set();
  const missing = onCalendar.filter((item) => {
    const key = item.region.toLowerCase();
    if (includesPlace(listed, item.region) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return missing.map((item) => (
    <div
      key={item.region}
      role="note"
      style={{
        margin: "0 var(--gutter-screen) 10px",
        padding: "8px 12px",
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--border)",
        background: "var(--surface-card)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        font: "400 12px/1.4 var(--font-sans)",
        color: "var(--text-secondary)",
      }}
    >
      <span style={{ flex: 1 }}>
        <b style={{ fontWeight: 600, color: "var(--text-primary)" }}>{item.title}</b> is in {item.region}, which isn’t one of this day’s places.
      </span>
      {canEdit ? (
        <button type="button" onClick={() => onAdd(item.region)} style={{ flex: "none", font: "600 12px var(--font-sans)", color: "var(--accent)" }}>
          Add {item.region} as a day trip
        </button>
      ) : null}
    </div>
  ));
}

/**
 * Under a day in the Plan tab's day strip: a bar for the place the group
 * stays in, which reaches halfway across the gap to a neighbouring day
 * staying in the same place, so a run of days reads as one bar with
 * rounded ends. Laid out against the day's slot, whose width is the
 * button's, so it's the same under every day. `gap` is the strip's gap.
 */
export function StayBar({ run, gap }) {
  if (!run.stay) return null;
  const inset = 4;
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        bottom: -8,
        height: 3,
        left: run.startsHere ? inset : -gap / 2,
        right: run.endsHere ? inset : -gap / 2,
        borderTopLeftRadius: run.startsHere ? 2 : 0,
        borderBottomLeftRadius: run.startsHere ? 2 : 0,
        borderTopRightRadius: run.endsHere ? 2 : 0,
        borderBottomRightRadius: run.endsHere ? 2 : 0,
        background: "var(--geo)",
      }}
    />
  );
}

/**
 * On a day in the Plan tab's day strip: a small dashed dot when that day
 * has a day trip.
 */
export function DayTripDot({ selected }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 3,
        right: 3,
        width: 7,
        height: 7,
        borderRadius: "50%",
        border: `1.5px dashed ${selected ? "#fff" : "var(--geo)"}`,
        boxSizing: "border-box",
      }}
    />
  );
}
