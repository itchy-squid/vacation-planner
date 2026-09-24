// The calendar grid's geometry and the plan-positioning rules that go with
// it, shared by pages/DaySchedule.jsx and the proposal flow's hour picker
// (pages/ProposeBlock.jsx). They render the *same* grid — one with plan
// blocks on it, one with a selection layer over it — so the constants and
// the layout sweep live here rather than being copied into the second
// screen and drifting.
//
// The handoff specifies 60px per hour and a 56px time gutter; the app was
// already at 60px per hour (PX_PER_MIN = 1) with a 44px gutter, and on the
// "where this bundle's chrome differs from the real app, the real app
// wins" rule, the app's gutter is what stays.

import { dayIndexForDate } from "./planTime";

export const PX_PER_MIN = 1;
export const DAY_START_MIN = 0; // 00:00 — the grid always shows the full midnight-to-midnight day
export const DAY_END_MIN = 1440; // 24:00
export const GRID_HEIGHT = (DAY_END_MIN - DAY_START_MIN) * PX_PER_MIN;
export const SNAP_MIN = 15;
export const GUTTER_W = 44;

// Shortest window a proposal can claim. Below this the stops list has
// nowhere to put even one stop.
export const MIN_SELECTION_MIN = 30;

// Pointer travel (px) before a pointer-down on something draggable counts
// as a drag rather than a tap.
export const DRAG_THRESHOLD_PX = 5;

export function snapToGrid(rawMinute) {
  return Math.round(rawMinute / SNAP_MIN) * SNAP_MIN;
}

export function clampToDay(minute) {
  return Math.min(Math.max(minute, DAY_START_MIN), DAY_END_MIN);
}

export function minuteFromOffsetY(offsetY) {
  return DAY_START_MIN + offsetY / PX_PER_MIN;
}

export function topForMinute(minute) {
  return (minute - DAY_START_MIN) * PX_PER_MIN;
}

export function planStartMinute(plan) {
  return plan.startDt ? plan.startDt.minuteOfDay : 0;
}

// Measured across the real dates, not within one. This used to wrap with
// `% 1440`, which reads an overnight ferry correctly by luck and then
// gets everything longer wrong: a two-night stay reported 10h, and an
// exactly-24h one computed 0 and silently fell back to the sum of its
// items' durations.
function calendarDayUTC(dt) {
  return Date.UTC(dt.year, dt.month - 1, dt.day);
}

export function planDurationMinutes(plan) {
  if (plan.startDt && plan.endDt) {
    const days = (calendarDayUTC(plan.endDt) - calendarDayUTC(plan.startDt)) / 86400000;
    const d = days * 1440 + (plan.endDt.minuteOfDay - plan.startDt.minuteOfDay);
    if (d > 0) return d;
  }
  return plan.totalDurationMinutes || 60;
}

export function planEndMinute(plan) {
  return planStartMinute(plan) + planDurationMinutes(plan);
}

// One plan as it sits on ONE day, in minutes from THAT day's 00:00 — so a
// plan that began last night starts negative, and one running into
// tomorrow ends past DAY_END_MIN. Null when it doesn't touch the day at
// all.
//
// This is what makes a day view honest about hours it doesn't own the
// start of. Every day-scoped screen used to ask `dayIndexForDate(startDt)
// === dayIndex`, which is a plan's *start* day: the morning half of an
// overnight plan was invisible on the day it actually occupied, so the
// grid laid other blocks over it, the hour picker counted zero items in
// hours that were taken, and a placement there came back as a 409 naming
// a plan that wasn't on screen.
export function planOnDay(plan, tripStartDate, dayIndex) {
  if (!plan.startDt) return null;
  const planDayIndex = dayIndexForDate(plan.startDt, tripStartDate);
  if (planDayIndex == null) return null;
  const startMin = planStartMinute(plan) + (planDayIndex - dayIndex) * 1440;
  const endMin = startMin + planDurationMinutes(plan);
  if (startMin >= DAY_END_MIN || endMin <= DAY_START_MIN) return null;
  return {
    plan,
    startMin,
    endMin,
    continuesBefore: startMin < DAY_START_MIN,
    continuesAfter: endMin > DAY_END_MIN,
  };
}

// Every plan touching `dayIndex`, in the order the grid wants them.
export function plansOnDay(plans, tripStartDate, dayIndex) {
  return plans
    .map((plan) => planOnDay(plan, tripStartDate, dayIndex))
    .filter(Boolean)
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
}

export function overlaps(aStart, aEnd, bStart, bEnd) {
  // Any shared minute counts; touching edges don't. Same rule as
  // backend/app/routers/plans.py find_overlapping_plan.
  return aStart < bEnd && aEnd > bStart;
}

// Column-packing sweep: groups overlapping plans into clusters, then
// greedily assigns each plan to the first column whose previous occupant
// has already ended — same idea as Google-Calendar-style side-by-side
// event layout.
//
// Takes the day entries from plansOnDay above (not raw plans), so an
// overnight plan's morning hours pack against the day they land on rather
// than the day they started.
function clustersOf(entries) {
  const items = [...entries].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const clusters = [];
  let current = [];
  let currentEnd = -Infinity;
  for (const it of items) {
    if (current.length && it.startMin >= currentEnd) {
      clusters.push(current);
      current = [];
      currentEnd = -Infinity;
    }
    current.push(it);
    currentEnd = Math.max(currentEnd, it.endMin);
  }
  if (current.length) clusters.push(current);
  return clusters;
}

function packColumns(items) {
  const columnEnds = [];
  const colOf = new Map();
  for (const it of items) {
    let idx = columnEnds.findIndex((endT) => endT <= it.startMin);
    if (idx === -1) {
      idx = columnEnds.length;
      columnEnds.push(it.endMin);
    } else {
      columnEnds[idx] = it.endMin;
    }
    colOf.set(it.plan.id, idx);
  }
  return { colOf, numCols: columnEnds.length };
}

// Packs `entries` side by side inside a horizontal band of the grid
// (`left` and `width` as fractions of it). Returns each entry plus its
// own { left, width } fractions.
function packInto(entries, left, width) {
  const result = [];
  for (const cluster of clustersOf(entries)) {
    const { colOf, numCols } = packColumns(cluster);
    for (const it of cluster) {
      result.push({ ...it, left: left + (width * colOf.get(it.plan.id)) / numCols, width: width / numCols });
    }
  }
  return result;
}

// Where the group has split (lib/splits.js), each group gets a lane of its
// own over the split's hours — including a group with nothing planned yet,
// so there is somewhere to tap to plan for them. `daySplits` comes from
// lib/splits.js splitsOnDay; `keepBranch` drops lanes (Just me shows only
// yours). Lanes divide the width evenly, in the split's own group order,
// so a group keeps its side of the grid from one day to the next.
export function splitLanes(daySplits, keepBranch = () => true) {
  const lanes = [];
  for (const { split, startMin, endMin } of daySplits) {
    const shown = split.branches.filter(keepBranch);
    shown.forEach((branch, i) => {
      lanes.push({ split, branch, startMin, endMin, left: i / shown.length, width: 1 / shown.length });
    });
  }
  return lanes;
}

// A { startMin, endMin } span with one edge dragged `deltaMinutes` —
// snapped, kept on the grid, and never shorter than one snap. The other
// edge stays put. Used for a split's edges (pages/DaySchedule.jsx).
export function spanWithEdgeMoved({ startMin, endMin }, edge, deltaMinutes) {
  if (edge === "start") {
    const moved = snapToGrid(startMin + deltaMinutes);
    return { startMin: Math.min(Math.max(moved, DAY_START_MIN), endMin - SNAP_MIN), endMin };
  }
  const moved = snapToGrid(endMin + deltaMinutes);
  return { startMin, endMin: Math.max(Math.min(moved, DAY_END_MIN), startMin + SNAP_MIN) };
}

// Every entry with its { left, width } fractions of the grid. A plan in a
// group packs into that group's lane, so two options in one group's vote
// sit side by side inside the lane and never push into another group's.
// A plan for everyone never overlaps a split, so it packs across the full
// width as it always did. A group's plan whose lane isn't shown is left
// out (the caller already chose to hide that group).
export function layoutDayPlans(entries, lanes = []) {
  const laneOf = new Map(lanes.map((lane) => [lane.branch.id, lane]));
  const byLane = new Map();
  const everyone = [];
  for (const entry of entries) {
    const branchId = entry.plan.branchId ?? null;
    if (branchId == null) {
      everyone.push(entry);
    } else if (laneOf.has(branchId)) {
      if (!byLane.has(branchId)) byLane.set(branchId, []);
      byLane.get(branchId).push(entry);
    }
  }
  const result = packInto(everyone, 0, 1);
  byLane.forEach((laneEntries, branchId) => {
    const lane = laneOf.get(branchId);
    result.push(...packInto(laneEntries, lane.left, lane.width));
  });
  return result;
}

// The hours already out for a vote on this day, read straight off the
// contested plans rather than fetched separately: every option in a
// contest spans exactly the contest's window (see backend/app/models.py
// Contest), so any one of them tells you the window.
export function contestWindowsFrom(entries) {
  const byContest = new Map();
  entries
    .filter((e) => e.plan.status === "contested" && e.plan.contestId)
    .forEach((e) => {
      if (byContest.has(e.plan.contestId)) return;
      byContest.set(e.plan.contestId, {
        contestId: e.plan.contestId,
        startMin: e.startMin,
        endMin: e.endMin,
      });
    });
  return [...byContest.values()].sort((a, b) => a.startMin - b.startMin);
}
