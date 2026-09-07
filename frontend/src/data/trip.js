import { parseISODate, MONTH_NAMES } from "../lib/format";

// Trip day numbers/weekdays exactly as seeded in the interactive prototype
// (TRIP_DAYS). Historical reference only now — pages/DaySchedule.jsx and
// components/planner/AvailabilityGrid.jsx (via pages/EditVisit.jsx) both
// derive their day strips from the trip's actual start_date/end_date via
// getTripDays() below instead, so editing a trip's dates
// (pages/TripSettings.jsx) is reflected in both places. TRIP_DAYS survives
// only as getTripDays()'s fallback day count for a trip with no start date
// yet.
export const TRIP_DAYS = [
  { n: 3, dow: "FRI" },
  { n: 4, dow: "SAT" },
  { n: 5, dow: "SUN" },
  { n: 6, dow: "MON" },
  { n: 7, dow: "TUE" },
  { n: 8, dow: "WED" },
  { n: 9, dow: "THU" },
  { n: 10, dow: "FRI" },
];

const DOW_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

// Computes the real calendar date for each day of the trip from
// Trip.start_date/end_date (backend/app/models.py; "YYYY-MM-DD" strings —
// see lib/format.js parseISODate for why these are parsed without going
// through local-timezone `Date` conversion). Returns one entry per day of
// the trip, in order: { n: <day-of-month>, dow: <"MON" etc>, month: <"Oct"
// etc>, weekday: <0=Sun..6=Sat> }. `weekday` is what
// components/planner/AvailabilityGrid.jsx uses to lay real trip days into
// Sunday-starting calendar-week rows.
//
// A trip with no start_date yet (see pages/TripSettings.jsx — dates are
// optional) has no calendar to compute, so this falls back to bare day
// numbers 1..fallbackDayCount with dow/month left blank (and `weekday`
// simply counting 0..6, 0..6, ... so consumers can still lay the days out
// in weeks of 7 even though the grouping isn't tied to a real Sunday);
// callers (dayHeaderLabel below, pages/DaySchedule.jsx) render those
// without the weekday/date suffix rather than guessing a real calendar.
export function getTripDays(startDate, endDate, fallbackDayCount = TRIP_DAYS.length) {
  const start = parseISODate(startDate);
  if (!start) {
    return Array.from({ length: fallbackDayCount }, (_, i) => ({ n: i + 1, dow: "", month: "", weekday: i % 7 }));
  }
  const end = parseISODate(endDate) ?? start;

  const startUTC = Date.UTC(start.year, start.month - 1, start.day);
  const endUTC = Date.UTC(end.year, end.month - 1, end.day);
  const dayCount = Math.max(1, Math.round((endUTC - startUTC) / 86400000) + 1);

  const days = [];
  for (let i = 0; i < dayCount; i++) {
    const d = new Date(startUTC + i * 86400000);
    const weekday = d.getUTCDay();
    days.push({ n: d.getUTCDate(), dow: DOW_NAMES[weekday], month: MONTH_NAMES[d.getUTCMonth()], weekday });
  }
  return days;
}

// "Day N" in the product = the Nth day of the trip, 1-indexed. Derives the
// weekday/month/day-of-month from the trip's real dates via getTripDays()
// rather than the fixed TRIP_DAYS list above.
export function tripDayLabel(dayIndex, startDate, endDate) {
  const d = getTripDays(startDate, endDate)[dayIndex - 1];
  if (!d) return `Day ${dayIndex}`;
  if (!d.dow) return `Day ${dayIndex}`;
  return `Day ${dayIndex} · ${d.dow[0]}${d.dow.slice(1).toLowerCase()} ${d.month} ${d.n}`;
}
