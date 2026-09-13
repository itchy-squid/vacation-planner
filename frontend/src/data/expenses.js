import { dayIndexForDate } from "../lib/planTime";
import { tripDayLabel } from "./trip";

// What the trip costs, derived from the plans the app has already
// fetched — there is no expenses endpoint (see docs/features/
// proposals-and-expenses-feature-spec.md §2).
//
// The one rule worth stating plainly, because every number here depends on
// it: an item's `costCents` is the *whole* cost, for everyone sharing it.
// Per-head is a division done for display and never stored, so a row total
// and the trip total can't drift apart no matter how the rounding falls —
// three people splitting $10.00 each see $3.33, and the trip still shows
// $10.00 rather than $9.99.

// A cost counts once it's on the calendar for real. A contested plan is a
// proposal and a draft is private, so neither is money the group has
// agreed to spend yet.
export const SCHEDULED_STATUSES = ["placed", "pencilled", "locked"];

// Who a cost is split between. An empty `heads` means everyone, which is
// the common case — and "everyone" is the trip's traveller count, not its
// contributor count, because the people planning a trip and the people
// going on it are different questions (feature spec decision 9). Floors at
// 1 so the division below can never blow up on a trip with neither.
export function headcountFor(item, trip, contributors) {
  const heads = item.heads ?? [];
  if (heads.length) return heads.length;
  return trip?.travellerCount || contributors.length || 1;
}

export function perHeadCents(item, headcount) {
  return Math.round((item.costCents ?? 0) / Math.max(1, headcount));
}

// Whole dollars where the amount is whole, cents where it isn't. The
// cents matter specifically on the per-head figure: $15 split four ways is
// $3.75, and rounding that to "$4 × 4" would print arithmetic that visibly
// disagrees with the $15 total sitting next to it.
export function formatMoney(cents) {
  const value = (cents ?? 0) / 100;
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function initialsFor(heads, contributors) {
  return heads
    .map((id) => contributors.find((c) => c.id === id))
    .filter(Boolean)
    .map((c) => c.initial)
    .join(", ");
}

// One row per scheduled item, grouped by trip day, plus the two summary
// numbers. Days with no priced items produce no card at all.
export function buildExpenses(plans, { trip, contributors, viewerId }) {
  const rows = [];

  plans
    .filter((plan) => SCHEDULED_STATUSES.includes(plan.status))
    .forEach((plan) => {
      const dayIndex = plan.startDt ? dayIndexForDate(plan.startDt, trip.startDate) : null;
      plan.items.forEach((item, index) => {
        const heads = item.heads ?? [];
        const headcount = headcountFor(item, trip, contributors);
        const isSubset = heads.length > 0;
        rows.push({
          key: `${plan.id}-${item.pinId ?? "t"}-${item.travelItemId ?? "p"}-${index}`,
          pinId: item.pinId,
          travelItemId: item.travelItemId,
          dayIndex,
          title: item.title,
          // Served pre-computed by the API, so this agrees with the
          // compare and itinerary stop lists by construction.
          startMinuteOfDay: item.startMinuteOfDay,
          costCents: item.costCents ?? 0,
          headcount,
          perHeadCents: perHeadCents(item, headcount),
          heads,
          // A subset spells out whose cost it is; "everyone" doesn't need
          // to name four people to say so.
          headsLabel: isSubset ? initialsFor(heads, contributors) : "",
          // Drives the accent bar's colour: the viewer's own money reads
          // differently from the trip's.
          viewerIsHead: isSubset ? heads.includes(viewerId) : true,
        });
      });
    });

  const priced = rows.filter((r) => r.costCents > 0);
  const free = rows.filter((r) => r.costCents === 0);

  const byDay = new Map();
  priced.forEach((row) => {
    const key = row.dayIndex ?? 0;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(row);
  });

  const days = [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([dayIndex, dayRows]) => ({
      dayIndex,
      label: tripDayLabel(dayIndex, trip.startDate, trip.endDate),
      rows: [...dayRows].sort((a, b) => (a.startMinuteOfDay ?? 0) - (b.startMinuteOfDay ?? 0)),
    }));

  return {
    days,
    freeRows: free.sort((a, b) => (a.dayIndex ?? 0) - (b.dayIndex ?? 0) || (a.startMinuteOfDay ?? 0) - (b.startMinuteOfDay ?? 0)),
    // Your share divides; the trip total never does.
    yourShareCents: priced
      .filter((r) => r.viewerIsHead)
      .reduce((sum, r) => sum + r.perHeadCents, 0),
    tripTotalCents: priced.reduce((sum, r) => sum + r.costCents, 0),
    pricedCount: priced.length,
  };
}
