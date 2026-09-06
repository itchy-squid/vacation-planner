// Trip day numbers/weekdays exactly as seeded in the interactive prototype
// (TRIP_DAYS). Fictional-but-fixed decoration for the day-strip in
// DaySchedule — the backend's Trip model doesn't store a day-by-day
// calendar (see backend/app/models.py), so this stays local, same as the
// decorative blocks in data/schedule.js.
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

// "Day N" in the product = the Nth day of the trip, 1-indexed.
export function tripDayLabel(dayIndex) {
  const d = TRIP_DAYS[dayIndex - 1];
  return d ? `Day ${dayIndex} · ${d.dow[0]}${d.dow.slice(1).toLowerCase()} Oct ${d.n}` : `Day ${dayIndex}`;
}
