// Where step 2 of "propose a block" may claim hours, and for whom. Pure
// functions over a day's plan entries (lib/dayGrid.js plansOnDay) and its
// splits (lib/splits.js splitsOnDay), shared by the hour picker and the
// screen around it so the two can't disagree.
//
// A claim is for one audience: everyone, or one group of a split
// (branchId). That decides everything about where it can reach
// (backend/app/splits.py):
//
// - For everyone, the whole day is open except pinned (locked) plans for
//   everyone and every split's hours — split hours belong to the groups.
// - For a group, only its split's hours are open, and only that group's
//   own pinned plans are in the way. The other groups' plans, pinned or
//   not, are theirs and never block the drag.
//
// The picker clips a drag at the first thing in the way rather than
// refusing it, so the grid feels like it's holding the edge for you
// (feature spec §6.5).

import { DAY_END_MIN, DAY_START_MIN } from "./dayGrid";
import { splitAt } from "./splits";

// Which group a drag starting at `anchorMin` is for. Outside any split it's
// everyone. Inside one it's `preferredBranchId` if that group is part of
// this split — so switching groups and dragging again keeps your choice —
// else the viewer's own group there, else the split's first group.
export function scopeForAnchor(daySplits, anchorMin, preferredBranchId, myTravelerId) {
  const hit = splitAt(daySplits, anchorMin);
  if (!hit) return null;
  const { branches } = hit.split;
  if (branches.some((b) => b.id === preferredBranchId)) return preferredBranchId;
  const mine = branches.find((b) => myTravelerId != null && b.travelerIds.includes(myTravelerId));
  return (mine ?? branches[0]).id;
}

// The limits a claim for `branchId` has: { min, max, blocked: [{start, end}] }.
export function claimBounds(dayEntries, daySplits, branchId) {
  const lockedFor = (id) =>
    dayEntries
      .filter((e) => e.plan.status === "locked" && (e.plan.branchId ?? null) === id)
      .map((e) => ({ start: e.startMin, end: e.endMin }));

  if (branchId == null) {
    const splitSpans = daySplits.map((s) => ({ start: s.startMin, end: s.endMin }));
    return {
      min: DAY_START_MIN,
      max: DAY_END_MIN,
      blocked: [...lockedFor(null), ...splitSpans].sort((a, b) => a.start - b.start),
    };
  }
  const home = daySplits.find((s) => s.split.branches.some((b) => b.id === branchId));
  return {
    min: Math.max(DAY_START_MIN, home?.startMin ?? DAY_START_MIN),
    max: Math.min(DAY_END_MIN, home?.endMin ?? DAY_END_MIN),
    blocked: lockedFor(branchId).sort((a, b) => a.start - b.start),
  };
}

// Grow a selection from `anchor` towards `moving`, stopping at the edge of
// the open hours and at the first blocked span in the way.
export function clipFromAnchor(anchor, moving, bounds) {
  const start = Math.min(Math.max(anchor, bounds.min), bounds.max);
  let lo = Math.max(Math.min(start, moving), bounds.min);
  let hi = Math.min(Math.max(start, moving), bounds.max);
  for (const span of bounds.blocked) {
    if (!(lo < span.end && hi > span.start)) continue;
    if (span.start >= start) hi = Math.min(hi, span.start);
    else lo = Math.max(lo, span.end);
  }
  return { startMin: lo, endMin: Math.max(lo, hi) };
}

// An existing selection re-fitted to another group's limits (switching
// which group a block is for keeps the hours where it can).
export function refitSelection(selection, bounds) {
  if (!selection) return null;
  return clipFromAnchor(selection.startMin, selection.endMin, bounds);
}
