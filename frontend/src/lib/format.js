// Small formatting helpers for values that come from the API as raw
// numbers/timestamps but the design wants phrased as copy (handoff README
// "Content fundamentals": never show a raw value where a sentence reads
// better).

export function relativeTime(isoString, now = new Date()) {
  if (!isoString) return "";
  const then = new Date(isoString);
  const diffMs = now.getTime() - then.getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.round(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}
export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Parses a plain "YYYY-MM-DD" date string (what the API sends for
// Trip.start_date/end_date — see backend/app/schemas.py TripOut) into
// {year, month, day} without going through `Date`/local-timezone
// conversion. These are calendar dates with no time component;
// `new Date("YYYY-MM-DD")` parses as UTC midnight, which formats a day
// early in any negative-UTC-offset timezone once passed through local
// getters — splitting the string sidesteps that entirely.
export function parseISODate(value) {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return { year: y, month: m, day: d };
}

function formatOneDate({ year, month, day }) {
  return `${MONTH_NAMES[month - 1]} ${day}, ${year}`;
}

// Renders a trip's start/end dates as the short copy the design wants
// ("Oct 3 – 10") instead of the raw ISO values the API returns. Day-level
// scheduling (Day 5, availability rules) is kept by day of the trip, not
// by date — see frontend/src/data/trip.js — so this is purely the
// trip-level display line.
export function formatDateRange(startDate, endDate) {
  const start = parseISODate(startDate);
  const end = parseISODate(endDate);

  if (!start && !end) return "Dates TBD";
  if (start && !end) return `From ${formatOneDate(start)}`;
  if (!start && end) return `Through ${formatOneDate(end)}`;

  if (start.year === end.year && start.month === end.month && start.day === end.day) {
    return formatOneDate(start);
  }
  if (start.year === end.year && start.month === end.month) {
    return `${MONTH_NAMES[start.month - 1]} ${start.day} – ${end.day}`;
  }
  if (start.year === end.year) {
    return `${MONTH_NAMES[start.month - 1]} ${start.day} – ${MONTH_NAMES[end.month - 1]} ${end.day}`;
  }
  return `${formatOneDate(start)} – ${formatOneDate(end)}`;
}

/** "45m", "2h", "1h 5m": a length of time in minutes, as the calendar says it. */
export function formatDuration(minutes) {
  const total = Math.max(0, Math.round(minutes ?? 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export const FULL_MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// "About 5 days" for a trip planned before its dates are known.
export function formatLength(lengthDays) {
  if (lengthDays === 7) return "About a week";
  if (lengthDays === 14) return "About two weeks";
  return `About ${lengthDays} ${lengthDays === 1 ? "day" : "days"}`;
}

// When a trip is, as the trip-level line: its dates ("Oct 3 – 10"), or for
// a trip planned before its dates are known its length and rough month
// ("About 5 days · March"). Takes the API's own field names, so it reads
// a trip, an invite or a link preview alike.
export function formatTripWhen({ start_date, end_date, length_days, rough_month }) {
  if (start_date || end_date || !length_days) return formatDateRange(start_date, end_date);
  return rough_month ? `${formatLength(length_days)} · ${FULL_MONTH_NAMES[rough_month - 1]}` : formatLength(length_days);
}
