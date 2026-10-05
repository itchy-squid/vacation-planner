// Everything on a trip's calendar is stored by day of the trip rather
// than by date (backend app/tripdays.py), so a trip can be planned before
// its dates are known and moved without anything losing its day. A time
// comes back from the API as a "trip minute": minutes from 00:00 on the
// trip's first day, so 09:00 on day 3 is 2 * 1440 + 540. It's wall-clock
// time wherever the trip is; there's no timezone in it.

export const MINUTES_PER_DAY = 1440;

const BAND_MINUTE_RANGES = {
  AM: [360, 720], // 06:00–12:00
  PM: [720, 1080], // 12:00–18:00
  EVE: [1080, 1440], // 18:00–24:00
};

// { dayIndex, minuteOfDay } for a trip minute: dayIndex is 1-based, and
// minuteOfDay is within that day (0..1439).
export function dayTime(tripMin) {
  if (tripMin == null) return null;
  const dayCarry = Math.floor(tripMin / MINUTES_PER_DAY);
  return { dayIndex: dayCarry + 1, minuteOfDay: tripMin - dayCarry * MINUTES_PER_DAY };
}

// The trip minute for `minuteOfDay` on day `dayIndex` (1-based) — the
// inverse of dayTime. `minuteOfDay` is deliberately NOT confined to one
// day: a plan that crosses midnight — a night crossing, a red-eye, a
// hotel — ends at minute 1800 of the day it began, and a continuation
// block dragged on the following day can ask for a negative one. Both
// simply land on the neighbouring day.
export function tripMinute(dayIndex, minuteOfDay) {
  return (dayIndex - 1) * MINUTES_PER_DAY + minuteOfDay;
}

// The day of the trip (1-based) a trip minute falls on.
export function dayIndexOfMinute(tripMin) {
  return Math.floor(tripMin / MINUTES_PER_DAY) + 1;
}

export function bandForMinuteOfDay(minuteOfDay) {
  for (const [band, [lo, hi]] of Object.entries(BAND_MINUTE_RANGES)) {
    if (minuteOfDay >= lo && minuteOfDay < hi) return band;
  }
  return "EVE";
}

// Every band a [startMin, endMin) range touches, in AM/PM/EVE order — the
// band-shaped question ("which of this pin's bands are in play?") asked of
// a minute-shaped window, such as a proposal's hours. Half-open on both sides, so a block ending exactly at 18:00
// is PM alone and not PM+EVE.
//
// The ranges above start at 06:00, so a window lying entirely before then
// touches nothing; rather than return an empty list (which would read as
// "no band works" and quietly rule every pin out), fall back to the same
// answer bandForMinuteOfDay already gives that minute.
export function bandsForMinuteRange(startMin, endMin) {
  const hit = Object.entries(BAND_MINUTE_RANGES)
    .filter(([, [lo, hi]]) => startMin < hi && endMin > lo)
    .map(([band]) => band);
  return hit.length ? hit : [bandForMinuteOfDay(startMin)];
}

// {dayIndex, band} for a normalized plan (see state/PlannerContext.jsx
// normalizePlan, which attaches startDt) — used wherever a plan needs to
// be shown against the day/band-shaped AvailabilityGrid.
export function dayIndexAndBandForPlan(plan) {
  if (!plan?.startDt) return null;
  return { dayIndex: plan.startDt.dayIndex, band: bandForMinuteOfDay(plan.startDt.minuteOfDay) };
}

export function clockLabel(minuteOfDay) {
  if (minuteOfDay == null) return "";
  const t = ((minuteOfDay % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
