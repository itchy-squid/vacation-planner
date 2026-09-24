// The group splitting up for part of a day. Mirrors backend/app/splits.py —
// read that module's docstring for the model. In short:
//
// - A split is a stretch of hours with two or more branches (groups), each
//   holding exactly which travelers are in it.
// - A plan or contest with a `branchId` belongs to that group and lies
//   inside its split's hours. A plan with no branch is for everyone and
//   never overlaps a split.
// - So two plans collide exactly when their hours overlap and they have
//   the same branchId. Nothing on the client has to reason about who is on
//   which plan to decide that.
//
// Plans and contests also arrive with `partyMembers` (the travelers they
// are for right now) and `forEveryone`, so screens that only want faces or
// names never need to look the branch up.

import { clockLabel, dayIndexForDate } from "./planTime";

// Every branch of every split, by id.
export function branchesById(splits) {
  const map = new Map();
  splits.forEach((split) => split.branches.forEach((branch) => map.set(branch.id, { ...branch, split })));
  return map;
}

// The split and branch a traveler is in, within one split. Null when
// they're in none of its groups (doing their own thing).
export function branchOf(split, travelerId) {
  if (!split || travelerId == null) return null;
  return split.branches.find((b) => b.travelerIds.includes(travelerId)) ?? null;
}

// Whether a traveler is on a plan. A viewer who isn't travelling (null) is
// on nothing but plans for everyone.
export function planIncludes(plan, travelerId) {
  if (!plan || plan.forEveryone) return true;
  return travelerId != null && (plan.partyMembers ?? []).includes(travelerId);
}

// The travelers on a plan or branch (anything with `partyMembers` and
// `forEveryone`, or a branch's `travelerIds`), in roster order.
export function membersOf(thing, travelers) {
  if (!thing || thing.forEveryone) return travelers;
  const ids = new Set(thing.travelerIds ?? thing.partyMembers ?? []);
  return travelers.filter((t) => ids.has(t.id));
}

// The travelers with these ids, in roster order.
export function travelersWithIds(ids, travelers) {
  const set = new Set(ids ?? []);
  return travelers.filter((t) => set.has(t.id));
}

// "Ana", "Ana and Lin", "Mei, Jae and Theo".
export function namesOf(people) {
  const names = people.map((p) => p.name);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// What to call a group: its label, else who is in it.
export function branchName(branch, travelers) {
  if (!branch) return "Everyone";
  return branch.label || namesOf(membersOf(branch, travelers)) || "Nobody yet";
}

// The travelers in no group of this split — free, and worth saying so.
export function unassigned(split, travelers) {
  const placed = new Set(split.branches.flatMap((b) => b.travelerIds));
  return travelers.filter((t) => !placed.has(t.id));
}

// One split as it sits on one day, in minutes from that day's 00:00 (the
// same shape lib/dayGrid.js planOnDay gives a plan). Null when it doesn't
// touch the day.
export function splitOnDay(split, tripStartDate, dayIndex) {
  if (!split.startDt || !split.endDt) return null;
  const startDay = dayIndexForDate(split.startDt, tripStartDate);
  const endDay = dayIndexForDate(split.endDt, tripStartDate);
  if (startDay == null || endDay == null) return null;
  const startMin = split.startDt.minuteOfDay + (startDay - dayIndex) * 1440;
  const endMin = split.endDt.minuteOfDay + (endDay - dayIndex) * 1440;
  if (startMin >= 1440 || endMin <= 0) return null;
  return { split, startMin, endMin };
}

export function splitsOnDay(splits, tripStartDate, dayIndex) {
  return splits
    .map((split) => splitOnDay(split, tripStartDate, dayIndex))
    .filter(Boolean)
    .sort((a, b) => a.startMin - b.startMin);
}

// The split on this day whose hours hold `minute`, or null.
export function splitAt(daySplits, minute) {
  return daySplits.find((s) => minute >= s.startMin && minute < s.endMin) ?? null;
}

// Why a split can't take these hours on this day, if it can't — the same
// refusals, in the same words, as backend/app/splits.py retime_split, so
// a dragged edge that won't hold says what's in the way without a round
// trip. Only this day's plans are checked (`entries`, from lib/dayGrid.js
// plansOnDay); the server checks the rest.
export function splitHoursProblem(daySplit, startMin, endMin, { daySplits, entries, travelers }) {
  const { split } = daySplit;
  const other = daySplits.find((s) => s.split.id !== split.id && startMin < s.endMin && endMin > s.startMin);
  if (other) return `The group is already split up from ${clockLabel(other.startMin)}–${clockLabel(other.endMin)}.`;

  const branches = new Map(split.branches.map((b) => [b.id, b]));
  for (const entry of entries) {
    const branchId = entry.plan.branchId ?? null;
    if (branches.has(branchId) && (entry.startMin < startMin || entry.endMin > endMin)) {
      return inTheWay(entry, `for ${branchName(branches.get(branchId), travelers)}`, "outside those hours");
    }
    if (branchId == null && entry.startMin < endMin && entry.endMin > startMin) {
      return inTheWay(entry, "for everyone", "inside those hours");
    }
  }
  return null;
}

function inTheWay({ plan, startMin, endMin }, whose, where) {
  const hours = `${clockLabel(startMin)}–${clockLabel(endMin)}`;
  if (plan.status === "contested") return `There's a vote in progress ${whose} from ${hours}, ${where}. Settle it first.`;
  const title = plan.label || plan.items?.[0]?.title || "A plan";
  return `${title} ${whose} runs ${hours}, ${where}. Move it first.`;
}

// The whole-assignment payload PUT /api/splits/{id} takes, from a split
// with one traveler moved into `toBranchId` (null: into no group).
export function withTravelerMoved(split, travelerId, toBranchId) {
  return split.branches.map((b) => ({
    id: b.id,
    label: b.label,
    takes_newcomers: b.takesNewcomers,
    traveler_ids:
      b.id === toBranchId
        ? [...new Set([...b.travelerIds, travelerId])]
        : b.travelerIds.filter((id) => id !== travelerId),
  }));
}

// The same payload with one branch's takes-newcomers flag changed. Only
// one group may take newcomers, so turning it on turns it off elsewhere.
export function withNewcomersGoingTo(split, branchId) {
  return split.branches.map((b) => ({
    id: b.id,
    label: b.label,
    takes_newcomers: b.id === branchId,
    traveler_ids: b.travelerIds,
  }));
}
