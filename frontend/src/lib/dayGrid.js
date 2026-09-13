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

export const PX_PER_MIN = 1;
export const DAY_START_MIN = 0; // 00:00 — the grid always shows the full midnight-to-midnight day
export const DAY_END_MIN = 1440; // 24:00
export const GRID_HEIGHT = (DAY_END_MIN - DAY_START_MIN) * PX_PER_MIN;
export const SNAP_MIN = 15;
export const GUTTER_W = 44;

// Shortest window a proposal can claim. Below this the stops list has
// nowhere to put even one stop.
export const MIN_SELECTION_MIN = 30;

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

export function planDurationMinutes(plan) {
  if (plan.startDt && plan.endDt) {
    const d = (plan.endDt.minuteOfDay - plan.startDt.minuteOfDay + 1440) % 1440;
    if (d > 0) return d;
  }
  return plan.totalDurationMinutes || 60;
}

export function planEndMinute(plan) {
  return planStartMinute(plan) + planDurationMinutes(plan);
}

export function overlaps(aStart, aEnd, bStart, bEnd) {
  // Any shared minute counts; touching edges don't. Same rule as
  // backend/app/routers/plans.py find_overlapping_plan.
  return aStart < bEnd && aEnd > bStart;
}

// Column-packing sweep: groups overlapping plans into clusters, then
// greedily assigns each plan to the first column whose previous
// occupant has already ended — same idea as Google-Calendar-style
// side-by-side event layout. Returns { plan, start, end, col, numCols }.
export function layoutDayPlans(plans) {
  const items = plans
    .map((p) => ({ plan: p, start: planStartMinute(p), end: planEndMinute(p) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const clusters = [];
  let current = [];
  let currentEnd = -Infinity;
  for (const it of items) {
    if (current.length && it.start >= currentEnd) {
      clusters.push(current);
      current = [];
      currentEnd = -Infinity;
    }
    current.push(it);
    currentEnd = Math.max(currentEnd, it.end);
  }
  if (current.length) clusters.push(current);

  const result = [];
  for (const cluster of clusters) {
    const columnEnds = [];
    const colOf = new Map();
    for (const it of cluster) {
      let idx = columnEnds.findIndex((endT) => endT <= it.start);
      if (idx === -1) {
        idx = columnEnds.length;
        columnEnds.push(it.end);
      } else {
        columnEnds[idx] = it.end;
      }
      colOf.set(it.plan.id, idx);
    }
    const numCols = columnEnds.length;
    for (const it of cluster) {
      result.push({ plan: it.plan, start: it.start, end: it.end, col: colOf.get(it.plan.id), numCols });
    }
  }
  return result;
}

// The hours already out for a vote on this day, read straight off the
// contested plans rather than fetched separately: every option in a
// contest spans exactly the contest's window (see backend/app/models.py
// Contest), so any one of them tells you the window.
export function contestWindowsFrom(dayPlans) {
  const byContest = new Map();
  dayPlans
    .filter((p) => p.status === "contested" && p.contestId)
    .forEach((p) => {
      if (byContest.has(p.contestId)) return;
      byContest.set(p.contestId, {
        contestId: p.contestId,
        startMin: planStartMinute(p),
        endMin: planEndMinute(p),
      });
    });
  return [...byContest.values()].sort((a, b) => a.startMin - b.startMin);
}
