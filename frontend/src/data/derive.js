// Pure formatting/sequencing helpers shared by the compare and itinerary
// screens. Set totals themselves (duration, cost, moving time, slack) now
// come from the backend for real candidate sets — see
// backend/app/derive.py, which this module mirrored before the API existed
// — so only the client-only "Set C" draft still needs them computed here.

export function fmtMin(totalMinutes) {
  const sign = totalMinutes < 0 ? "−" : "";
  const abs = Math.abs(totalMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h) return `${sign}${h}h${m ? ` ${m}m` : ""}`;
  return `${sign}${m}m`;
}

export function clock(minutesFromMidnight) {
  const t = ((minutesFromMidnight % 1440) + 1440) % 1440;
  const h = String(Math.floor(t / 60)).padStart(2, "0");
  const m = String(t % 60).padStart(2, "0");
  return `${h}:${m}`;
}

export function slackColor(slackMinutes) {
  return slackMinutes < 15 ? "var(--warn)" : "var(--geo)";
}

// Sequential per-stop start/end times for a set's stops — the backend only
// gives aggregate totals per set (total_duration_minutes etc.), not a
// stop-by-stop schedule, so the map route and the "13:20–14:10" style
// labels in SetCard/DayCard are still sequenced client-side.
export function sequenceStops(stopPins, blockStartMinutes, gapMinutes) {
  let t = blockStartMinutes;
  return stopPins.map((pin) => {
    const start = t;
    t += pin.dur + gapMinutes;
    return { pin, start, end: start + pin.dur };
  });
}

// Totals for the local, unpersisted "Set C" draft — same formula as
// backend/app/derive.py's candidate_set_totals, since nothing on the
// backend computes this for a draft that doesn't exist there yet.
export function draftSetTotals(pins, draftIds, blockMinutes) {
  const stops = draftIds.map((id) => pins[id]).filter(Boolean);
  const moving = Math.max(0, (stops.length - 1) * 12);
  const dur = stops.reduce((a, p) => a + p.dur, 0);
  const cost = Math.round(stops.reduce((a, p) => a + p.cost, 0));
  return { stops, cost, moving, slack: blockMinutes - dur - moving };
}
