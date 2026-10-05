// What ideas paid by the day, and stays, cost over the whole trip. These
// are counted here rather than through the plans (data/expenses.js),
// because a stay is never on the calendar and a rental car is had for days
// at a time, not for the length of one block — so the server gives a stop
// for something paid by the day no money of its own (backend app/
// derive.py item_money).
//
// A price per day is a price per 24 hours: from the first day to the last
// of n days is n - 1 days of it, the way a hotel charges nights and a car
// rental charges days. Where those days come from:
//
//   a stay       the nights it's picked as where the group is staying in
//                "Where we'll be" (dayPlaces, by day). Each such night is
//                one day's worth: staying the 12th to the 15th, checking
//                out the 16th, is 4.
//   anything     its own first and last day (costStartDay/costEndDay),
//   else         at least one day's worth even when they're the same day.
//
// A stay paid once counts once, if it's booked for any night at all.
//
// Everyone on the trip shares it, the same rule stopMoney applies to a
// stop on a plan for everyone.
//
// Days are days of the trip (1 is the first; backend app/tripdays.py), so
// a trip can be costed before it has dates.
import { formatDateRange, parseISODate } from "./format.js";

/** n days from `first` to `last` (days of the trip, inclusive) is n - 1 days' worth, never less than one. */
export function daysCharged(first, last) {
  if (first == null || last == null) return 0;
  return Math.max(1, last - first);
}

/** The nights `pinId` is where the group stays, among `days` (the trip's days), in order. */
export function nightsAt(dayPlaces, days, pinId) {
  return days.filter((day) => dayPlaces[day]?.lodgingPinId === pinId);
}

// "Mar 12 – 16" when the trip has dates, else "Days 1–5".
function daysLabel(first, last, trip) {
  const start = parseISODate(trip?.startDate);
  if (start) {
    const iso = (day) => new Date(Date.UTC(start.year, start.month - 1, start.day + day - 1)).toISOString().slice(0, 10);
    return formatDateRange(iso(first), iso(last));
  }
  return first === last ? `Day ${first}` : `Days ${first}–${last}`;
}

/** Whether an idea's cost is counted here rather than through the plans. */
export function countedByTheDay(pin) {
  return pin.kind === "stay" || pin.costPer === "day";
}

/**
 * How many days of an idea's price are paid, and which days those are:
 * { count, first, last, label } — `count` 0 while none are known yet.
 * `last` is the day it ends (a stay's check-out), so `label` reads
 * "Mar 12 – 16" for four nights from the 12th (or "Days 1–5" on a trip
 * without dates).
 */
export function chargedDays(pin, { dayPlaces = {}, days = [], trip = null } = {}) {
  if (pin.kind === "stay") {
    const nights = nightsAt(dayPlaces, days, pin.id);
    if (!nights.length) return { count: 0, first: null, last: null, label: "" };
    const first = nights[0];
    const last = nights[nights.length - 1] + 1;
    return { count: pin.costPer === "day" ? nights.length : 1, nights: nights.length, first, last, label: daysLabel(first, last, trip) };
  }
  const count = daysCharged(pin.costStartDay, pin.costEndDay);
  if (!count) return { count: 0, first: null, last: null, label: "" };
  return { count, first: pin.costStartDay, last: pin.costEndDay, label: daysLabel(pin.costStartDay, pin.costEndDay, trip) };
}

/** "4 nights" for a stay, "3 days" for anything else. */
export function daysWord(pin, count) {
  const unit = pin.kind === "stay" ? "night" : "day";
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** { eachCents, totalCents } for `count` days of a price shared by `headcount` people. */
export function dailyMoney(pin, count, headcount) {
  const days = pin.costPer === "day" ? count : count > 0 ? 1 : 0;
  const price = (pin.costCents ?? 0) * days;
  const sharers = Math.max(1, headcount);
  if ((pin.costBasis ?? "per_head") === "group") return { eachCents: Math.round(price / sharers), totalCents: price };
  return { eachCents: price, totalCents: price * headcount };
}

/**
 * One row per idea counted by the day, priced and with its days known,
 * shaped like data/expenses.js's rows; and the ones with a price but no
 * days yet, so the screen can say what's missing.
 *
 *   pins       every idea on the trip (state.pins, by id)
 *   dayPlaces  day -> { lodgingPinId, ... }
 *   days       the trip's days (lib/dayPlaces.js tripDayNumbers)
 *   trip       the trip, for its dates
 *   travelers  the roster, who shares it
 *   shownIds   the travelers whose part of it is being shown
 */
export function buildDailyCosts(pins, { dayPlaces, days: tripDays, trip, travelers, shownIds }) {
  const shown = new Set(shownIds);
  const sharers = travelers.map((t) => t.id);
  const mine = sharers.filter((id) => shown.has(id));
  const rows = [];
  const waiting = [];

  Object.values(pins)
    .filter(countedByTheDay)
    .forEach((pin) => {
      if (pin.costCents == null) return; // a price this viewer can't see
      const days = chargedDays(pin, { dayPlaces, days: tripDays, trip });
      if (!days.count) {
        if (pin.costCents > 0) waiting.push({ key: `daily-${pin.id}`, pinId: pin.id, title: pin.title, kind: pin.kind });
        return;
      }
      const { eachCents, totalCents } = dailyMoney(pin, days.count, sharers.length);
      if (totalCents === 0) return;
      const rate = pin.costPer === "day" ? `${daysWord(pin, days.count)} × ${formatCents(pin.costCents)}` : `${daysWord(pin, days.nights ?? days.count)} · paid once`;
      rows.push({
        key: `daily-${pin.id}`,
        pinId: pin.id,
        title: pin.title,
        kind: pin.kind,
        first: days.first,
        howLabel: `${days.label} · ${rate}`,
        startMinuteOfDay: null,
        costBasis: pin.costBasis ?? "per_head",
        eachCents,
        totalCents,
        headcount: sharers.length,
        sharers,
        sharersLabel: "",
        shownCount: mine.length,
        shownCents: eachCents * mine.length,
      });
    });

  rows.sort((a, b) => a.first - b.first || a.title.localeCompare(b.title));
  waiting.sort((a, b) => a.title.localeCompare(b.title));
  return { rows, waiting };
}

function formatCents(cents) {
  const value = (cents ?? 0) / 100;
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 })}`;
}
