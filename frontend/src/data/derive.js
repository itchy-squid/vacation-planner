// Pure formatting/sequencing helpers shared by the compare and itinerary
// screens. Set/plan totals themselves (duration, cost, moving time,
// slack) come from the backend for real plans — see backend/app/
// derive.py — so nothing here computes totals anymore; the old
// draftSetTotals() was only for the local, unpersisted "Set C" draft,
// which no longer exists now that propose-an-alternative is a real,
// persisted backend flow (see docs/features/scheduling-feature-spec.md
// "Proposing an alternative").

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

// Sequential per-stop start/end times for a plan's stops — the backend
// only gives aggregate totals per plan (total_duration_minutes etc.), not
// a stop-by-stop schedule, so the map route and the "13:20–14:10" style
// labels are still sequenced client-side.
export function sequenceStops(stopPins, blockStartMinutes, gapMinutes) {
  let t = blockStartMinutes;
  return stopPins.map((pin) => {
    const start = t;
    t += pin.dur + gapMinutes;
    return { pin, start, end: start + pin.dur };
  });
}
