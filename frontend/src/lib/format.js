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
// scheduling (Day 5, availability rules) intentionally does NOT derive
// from these — see frontend/src/data/trip.js — so this is purely the
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
