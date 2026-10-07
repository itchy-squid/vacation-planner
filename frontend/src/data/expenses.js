import { tripDayLabel } from "./trip";
import { isTravelItem } from "../lib/travel";
import { clockLabel } from "../lib/planTime";
import { rowsByDay } from "../lib/dailyCosts";

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

// Money for a stop that isn't saved yet (a proposal still being built):
// the same rule the server applies. `memberIds` is who the block is for,
// and they share every stop in it.
export function stopMoney(stop, memberIds) {
  const sharers = memberIds ?? [];
  const count = Math.max(1, sharers.length);
  // Paid by the day: counted over its days, never per stop (lib/dailyCosts.js).
  const price = stop.costPer === "day" ? 0 : stop.costCents ?? 0;
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

// The two ways the screen lists costs; it's one or the other, never a mix.
export const GROUPINGS = ["day", "category"];

// What a cost is, from fields the trip already has — not from pins'
// free-form tags (feature spec decision 8). In this order on the screen.
export const CATEGORIES = [
  { key: "daily", label: "Passes & rentals" },
  { key: "lodging", label: "Lodging" },
  { key: "travel", label: "Travel" },
  { key: "activities", label: "Activities" },
];

function planItemCategory(item) {
  if (item.travelItemId != null && item.kind === "lodging") return "lodging";
  if (isTravelItem(item)) return "travel";
  return "activities";
}

function byTime(a, b) {
  return (a.dayIndex ?? 0) - (b.dayIndex ?? 0) || (a.startMinuteOfDay ?? 0) - (b.startMinuteOfDay ?? 0);
}

function group(key, label, rows) {
  return {
    key,
    label,
    rows,
    shownCents: rows.reduce((sum, r) => sum + r.shownCents, 0),
    totalCents: rows.reduce((sum, r) => sum + r.totalCents, 0),
  };
}

// One row per scheduled stop with a visible price, plus the summary for
// `shownIds` — the travelers the viewer chose to see. `daily` is the rows
// for stays and prices paid by the day (lib/dailyCosts.js
// buildDailyCosts), which aren't counted through the plans; they're added
// into every total here.
//
// Every cost comes out listed both ways, for the screen to show one:
//   byDay       under the trip day it happens on. A stay or rental paid
//               by the day is split into a day's worth under each of its
//               days (dailyCosts.js rowsByDay); flights are on the day they
//               leave.
//   byCategory  under CATEGORIES, in date order, each row saying its day.
export function buildExpenses(plans, { trip, travelers, shownIds, daily = [] }) {
  const shown = new Set(shownIds);
  const initials = new Map(travelers.map((t) => [t.id, t.initial]));
  const everyoneCount = travelers.length;
  const rows = [];

  plans
    .filter((plan) => SCHEDULED_STATUSES.includes(plan.status))
    .forEach((plan) => {
      const dayIndex = plan.startDt?.dayIndex ?? null;
      plan.items.forEach((item, index) => {
        if (item.totalCents == null) return; // a price this viewer can't see
        const sharers = item.sharerIds ?? [];
        const mine = sharers.filter((id) => shown.has(id));
        const isSubset = sharers.length < everyoneCount;
        rows.push({
          key: `${plan.id}-${item.pinId ?? "t"}-${item.travelItemId ?? "p"}-${index}`,
          dayIndex,
          category: planItemCategory(item),
          title: item.title,
          startMinuteOfDay: item.startMinuteOfDay,
          costBasis: item.costBasis,
          eachCents: item.eachCents ?? 0,
          totalCents: item.totalCents ?? 0,
          headcount: sharers.length,
          sharers,
          // Only a subset is spelled out; "everyone" doesn't need seven
          // initials to say so.
          sharersLabel: isSubset ? sharers.map((id) => initials.get(id)).filter(Boolean).join(", ") : "",
          shownCount: mine.length,
          shownCents: (item.eachCents ?? 0) * mine.length,
        });
      });
    });

  const priced = rows.filter((r) => r.totalCents > 0);
  const free = rows.filter((r) => r.totalCents === 0);
  const dailyRows = daily.map((row) => ({ ...row, category: row.kind === "stay" ? "lodging" : "daily" }));

  // By day. A day's worth of a stay or rental has no time, so it leads
  // its day.
  const byDayMap = new Map();
  const addToDay = (day, row) => {
    const key = day ?? 0;
    if (!byDayMap.has(key)) byDayMap.set(key, []);
    byDayMap.get(key).push(row);
  };
  priced.forEach((row) => addToDay(row.dayIndex, row));
  dailyRows.flatMap(rowsByDay).forEach((row) => addToDay(row.day, { ...row, dayIndex: row.day }));
  const byDay = [...byDayMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([dayIndex, dayRows]) => group(`day-${dayIndex}`, tripDayLabel(dayIndex, trip), [...dayRows].sort(byTime)));

  // By category. Each row says its day and time, since they aren't under
  // a day's heading; a stay or rental already says its days.
  const whenLabel = (row) =>
    [tripDayLabel(row.dayIndex, trip), row.startMinuteOfDay != null ? clockLabel(row.startMinuteOfDay) : null].filter(Boolean).join(" · ");
  const categorized = [
    ...priced.map((row) => ({ ...row, howLabel: whenLabel(row), startMinuteOfDay: null })),
    ...dailyRows.map((row) => ({ ...row, dayIndex: row.first })),
  ];
  const byCategory = CATEGORIES.map(({ key, label }) =>
    group(key, label, categorized.filter((r) => r.category === key).sort(byTime))
  ).filter((g) => g.rows.length > 0);

  const counted = [...priced, ...daily];

  // What each shown traveler's costs come to, for settling up.
  const perTraveler = travelers
    .filter((t) => shown.has(t.id))
    .map((t) => ({
      traveler: t,
      cents: counted.filter((r) => r.sharers.includes(t.id)).reduce((sum, r) => sum + r.eachCents, 0),
    }));

  return {
    byDay,
    byCategory,
    freeRows: free.sort(byTime),
    shownCents: counted.reduce((sum, r) => sum + r.shownCents, 0),
    tripTotalCents: counted.reduce((sum, r) => sum + r.totalCents, 0),
    perTraveler,
    pricedCount: counted.length,
  };
}
