import { getTripDays } from "./trip";

// Day labels only. The actual per-day blocks (placed/pencilled/empty, plus
// Day 5's contested block) now come straight from the backend — see
// state/PlannerContext.jsx (which fetches and normalizes them) and
// pages/DaySchedule.jsx (which derives the schedule and the unplaced tray
// from that real data). This file used to also export the mock
// CONTESTED_BLOCK/DAY5_FIXED_BLOCKS/OTHER_DAY_BLOCKS/UNPLACED_TRAY_TITLES
// content DaySchedule shipped against before the API existed
// (backend/app/seed.py now seeds the equivalent rows for real).
//
// startDate/endDate are the trip's real Trip.start_date/end_date (passed
// in by pages/DaySchedule.jsx from the loaded trip) — see data/trip.js
// getTripDays(). When the trip has no dates set yet, this reads as plain
// "Day N" with no weekday/date suffix.
export function dayHeaderLabel(dayIndex, startDate, endDate) {
  const d = getTripDays(startDate, endDate)[dayIndex - 1];
  if (!d || !d.dow) return `Day ${dayIndex}`;
  const dow = `${d.dow[0]}${d.dow.slice(1).toLowerCase()}`;
  return `Day ${dayIndex} · ${dow} ${d.month} ${d.n}`;
}
