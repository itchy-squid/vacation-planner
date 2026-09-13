// Pure formatting helpers shared by the compare, itinerary and proposal
// screens. Set/plan totals themselves (duration, cost, slack) come from
// the backend for real plans — see backend/app/derive.py — so nothing here
// computes totals anymore. The one exception is the proposal flow's local
// draft, which has no server-side plan to ask yet; it does its own
// arithmetic in pages/ProposeBlock.jsx, deliberately by the same rules.

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

// sequenceStops() used to live here: per-stop start/end times, sequenced
// client-side with a caller-supplied gap. It's gone because the gap was
// the problem — the backend now serves each PlanItem's own
// start_minute_of_day (see backend/app/derive.py), so the compare screen,
// the itinerary and the Expenses page all read one clock instead of three
// slightly different ones.
