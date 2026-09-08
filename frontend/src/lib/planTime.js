import { parseISODate } from "./format";

// Plan.starts_at/ends_at come back from the API as ISO datetimes, but
// they're not real UTC instants — the backend has nowhere to store a
// trip's real timezone yet, so it tags them tzinfo=UTC purely as a
// bookkeeping convention for "trip-local wall-clock time" (see
// backend/app/seed.py's TAIWAN_TRIP_START comment). Reading them with
// `new Date(iso).getHours()` would run them through the browser's local
// timezone and shift the clock time, so every read/write here works off
// the string's own Y-M-D/H:M digits directly — the same sidestep
// lib/format.js's parseISODate already makes for plain dates.

const BAND_MINUTE_RANGES = {
  AM: [360, 720], // 06:00–12:00
  PM: [720, 1080], // 12:00–18:00
  EVE: [1080, 1440], // 18:00–24:00
};

export function parseApiDateTime(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  return { year, month, day, hour, minute, minuteOfDay: hour * 60 + minute };
}

// 1-based day-of-trip for a {year,month,day} against the trip's
// start_date ("YYYY-MM-DD"), matching how backend/app/seed.py seeds
// day_index. Returns null when the trip has no start date yet.
export function dayIndexForDate({ year, month, day }, startDate) {
  const start = parseISODate(startDate);
  if (!start) return null;
  const startUTC = Date.UTC(start.year, start.month - 1, start.day);
  const dUTC = Date.UTC(year, month - 1, day);
  return Math.round((dUTC - startUTC) / 86400000) + 1;
}

export function bandForMinuteOfDay(minuteOfDay) {
  for (const [band, [lo, hi]] of Object.entries(BAND_MINUTE_RANGES)) {
    if (minuteOfDay >= lo && minuteOfDay < hi) return band;
  }
  return "EVE";
}

// {dayIndex, band} for a normalized plan (see state/PlannerContext.jsx
// normalizePlan, which attaches startDt) — used wherever a plan needs to
// be shown against the day/band-shaped AvailabilityGrid.
export function dayIndexAndBandForPlan(plan, startDate) {
  if (!plan?.startDt) return null;
  const dayIndex = dayIndexForDate(plan.startDt, startDate);
  if (dayIndex == null) return null;
  return { dayIndex, band: bandForMinuteOfDay(plan.startDt.minuteOfDay) };
}

// The inverse of parseApiDateTime + dayIndexForDate: given a trip's
// start_date, a 1-based day index, and a minute-of-day, builds the same
// tzinfo=UTC-tagged wall-clock ISO string the backend writes (see
// backend/app/seed.py _taiwan_dt) so a round trip through the API lands
// back on the exact clock time the user tapped.
export function isoForDayMinute(startDate, dayIndex, minuteOfDay) {
  const start = parseISODate(startDate);
  if (!start) return null;
  const startUTC = Date.UTC(start.year, start.month - 1, start.day);
  const dayUTC = startUTC + (dayIndex - 1) * 86400000;
  const d = new Date(dayUTC);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(hour)}:${pad(minute)}:00+00:00`;
}

export function clockLabel(minuteOfDay) {
  if (minuteOfDay == null) return "";
  const t = ((minuteOfDay % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
