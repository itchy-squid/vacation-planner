import { dayIndexForDate } from "../lib/planTime";
import { tripDayLabel } from "./trip";

// What the trip costs, derived from the plans the app has already fetched
// — there is no expenses endpoint (see docs/features/
// proposals-and-expenses-feature-spec.md §2).
//
// Prices are per person unless an item says "for the group"
// (backend/app/derive.py item_money). The server works out each scheduled
// stop's money, because it depends on who is on the plan: `sharerIds` (the
// travelers sharing it), `eachCents` (what one of them pays) and
// `totalCents` (the whole bill). Everything here adds those up.

// A cost counts once it's on the calendar for real. A contested plan is a
// proposal and a draft is private, so neither is money the group has
// agreed to spend yet.
export const SCHEDULED_STATUSES = ["placed", "pencilled", "locked"];

// Money for a stop that isn't saved yet (the propose screen's stop list):
// the same rule the server applies. `memberIds` is who the block is for.
export function stopMoney(stop, memberIds) {
  const heads = stop.heads ?? [];
  const sharers = heads.length ? heads : memberIds ?? [];
  const count = Math.max(1, sharers.length);
  const price = stop.costCents ?? 0;
  if ((stop.costBasis ?? "per_head") === "group") {
    return { headcount: sharers.length, perHeadCents: Math.round(price / count), totalCents: price };
  }
  return { headcount: sharers.length, perHeadCents: price, totalCents: price * count };
}

// Whole dollars where the amount is whole, cents where it isn't. The
// cents matter on the per-person figure: $15 split four ways is $3.75.
export function formatMoney(cents) {
  const value = (cents ?? 0) / 100;
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

// Who pays for a traveler: whoever they point at, or themselves.
export function payerOf(traveler) {
  return traveler.paidById ?? traveler.id;
}

// The travelers whose costs a "Showing" choice covers:
// - "paying": me and everyone I pay for (the default)
// - "me": just me
// - "everyone"
// - a traveler id: just them
export function travelersFor(scope, travelers, myTravelerId) {
  if (scope === "everyone") return travelers;
  if (scope === "me") return travelers.filter((t) => t.id === myTravelerId);
  if (scope === "paying") return travelers.filter((t) => payerOf(t) === myTravelerId);
  return travelers.filter((t) => t.id === scope);
}

// One row per scheduled stop with a visible price, grouped by trip day,
// plus the summary for `shownIds` — the travelers the viewer chose to see.
export function buildExpenses(plans, { trip, travelers, shownIds }) {
  const shown = new Set(shownIds);
  const initials = new Map(travelers.map((t) => [t.id, t.initial]));
  const everyoneCount = travelers.length;
  const rows = [];

  plans
    .filter((plan) => SCHEDULED_STATUSES.includes(plan.status))
    .forEach((plan) => {
      const dayIndex = plan.startDt ? dayIndexForDate(plan.startDt, trip.startDate) : null;
      plan.items.forEach((item, index) => {
        if (item.totalCents == null) return; // a price this viewer can't see
        const sharers = item.sharerIds ?? [];
        const mine = sharers.filter((id) => shown.has(id));
        const isSubset = sharers.length < everyoneCount;
        rows.push({
          key: `${plan.id}-${item.pinId ?? "t"}-${item.travelItemId ?? "p"}-${index}`,
          dayIndex,
          title: item.title,
          startMinuteOfDay: item.startMinuteOfDay,
          costBasis: item.costBasis,
          eachCents: item.eachCents ?? 0,
          totalCents: item.totalCents ?? 0,
          headcount: sharers.length,
          sharers,
          // Only a subset is spelled out; "everyone" doesn't need seven
          // initials to say so.
          headsLabel: isSubset ? sharers.map((id) => initials.get(id)).filter(Boolean).join(", ") : "",
          shownCount: mine.length,
          shownCents: (item.eachCents ?? 0) * mine.length,
        });
      });
    });

  const priced = rows.filter((r) => r.totalCents > 0);
  const free = rows.filter((r) => r.totalCents === 0);

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

  // What each shown traveler's costs come to, for settling up.
  const perTraveler = travelers
    .filter((t) => shown.has(t.id))
    .map((t) => ({
      traveler: t,
      cents: priced.filter((r) => r.sharers.includes(t.id)).reduce((sum, r) => sum + r.eachCents, 0),
    }));

  return {
    days,
    freeRows: free.sort((a, b) => (a.dayIndex ?? 0) - (b.dayIndex ?? 0) || (a.startMinuteOfDay ?? 0) - (b.startMinuteOfDay ?? 0)),
    shownCents: priced.reduce((sum, r) => sum + r.shownCents, 0),
    tripTotalCents: priced.reduce((sum, r) => sum + r.totalCents, 0),
    perTraveler,
    pricedCount: priced.length,
  };
}
