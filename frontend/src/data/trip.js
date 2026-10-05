import { parseISODate, MONTH_NAMES } from "../lib/format";

// Trip day numbers/weekdays exactly as seeded in the interactive prototype
// (TRIP_DAYS). Historical reference only now — every screen derives its
// days from the trip itself via getTripDays() below. TRIP_DAYS survives
// only as getTripDays()'s fallback day count for a trip with neither dates
// nor a length.
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

// One entry per day of the trip, in order: { day: <1-based day of the
// trip>, n: <day-of-month>, dow: <"MON" etc>, month: <"Oct" etc>, weekday:
// <0=Sun..6=Sat> }. `day` is how everything on the calendar is keyed
// (backend app/tripdays.py); the rest says which real date it falls on.
// `weekday` is 0=Sun..6=Sat.
//
// From Trip.start_date/end_date ("YYYY-MM-DD" strings — see lib/format.js
// parseISODate for why these are parsed without going through
// local-timezone `Date` conversion) when the trip has dates. A trip
// planned before its dates are known has a length instead (`dayCount`),
// so this gives bare day numbers 1..dayCount with dow/month left blank
// (and `weekday` simply counting 0..6, 0..6, ... so consumers can still lay
// the days out in weeks of 7 even though the grouping isn't tied to a real
// Sunday); callers (tripDayTitle below, pages/DaySchedule.jsx) render
// those without the weekday/date suffix rather than guessing a calendar.
// A trip with neither falls back to TRIP_DAYS' length.
export function getTripDays(trip) {
  const start = parseISODate(trip?.startDate);
  if (!start) {
    const count = trip?.dayCount ?? TRIP_DAYS.length;
    return Array.from({ length: count }, (_, i) => ({ day: i + 1, n: i + 1, dow: "", month: "", weekday: i % 7 }));
  }
  const end = parseISODate(trip.endDate) ?? start;

  const startUTC = Date.UTC(start.year, start.month - 1, start.day);
  const endUTC = Date.UTC(end.year, end.month - 1, end.day);
  const dayCount = Math.max(1, Math.round((endUTC - startUTC) / 86400000) + 1);

  const days = [];
  for (let i = 0; i < dayCount; i++) {
    const d = new Date(startUTC + i * 86400000);
    const weekday = d.getUTCDay();
    days.push({ day: i + 1, n: d.getUTCDate(), dow: DOW_NAMES[weekday], month: MONTH_NAMES[d.getUTCMonth()], weekday });
  }
  return days;
}

// "Sun, Mar 14" for day `dayIndex` (1-based), or "" for a trip without
// dates.
export function tripDayTitle(dayIndex, trip) {
  const d = getTripDays(trip)[dayIndex - 1];
  if (!d?.dow) return "";
  return `${d.dow[0]}${d.dow.slice(1).toLowerCase()}, ${d.month} ${d.n}`;
}

// "Day N" in the product = the Nth day of the trip, 1-indexed, with its
// weekday and date when the trip has dates.
export function tripDayLabel(dayIndex, trip) {
  const d = getTripDays(trip)[dayIndex - 1];
  if (!d?.dow) return `Day ${dayIndex}`;
  return `Day ${dayIndex} · ${d.dow[0]}${d.dow.slice(1).toLowerCase()} ${d.month} ${d.n}`;
}
