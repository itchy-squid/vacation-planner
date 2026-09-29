// Which blocks on the day grid can be dragged to a new time, and what a
// drag of each one asks the server to do. Pure, so pages/DaySchedule.jsx
// and its tests read the same rule.
//
// Two kinds of block move:
//
// - A placed or pencilled plan (plans:write). PATCH /api/plans/{id}.
// - A proposal with nothing competing for its hours — the contest's one
//   and only option. Its hours are the contest's, so the whole contest
//   moves with it: PATCH /api/contests/{id} (backend/app/routers/
//   contests.py move_lone_proposal). The same people who may edit the set
//   may move it: its author, or the trip owner (see pages/CompareSets.jsx
//   canEdit). Once a second option exists — another proposal, or the
//   board's own plans captured as the incumbent — the window is the
//   question everyone is voting on, and it stays put.
//
// Locked plans never move from the grid; they are reopened first.

// The plans in `plans` that are options in `contestId`'s vote. A contest's
// options are all plans (backend/app/models.py Contest.plans), so counting
// them off the trip's plan list is the whole of "is anything competing".
function optionCount(plans, contestId) {
  return plans.reduce((n, p) => (p.contestId === contestId && p.status === "contested" ? n + 1 : n), 0);
}

export function isLoneProposal(plan, plans) {
  return plan.status === "contested" && plan.contestId != null && optionCount(plans, plan.contestId) === 1;
}

// "plan" (PATCH the plan), "contest" (PATCH its contest), or null when the
// viewer can't drag this block at all.
export function dragKind(plan, { plans, canPlan, canPropose, currentUser }) {
  if (plan.status === "placed" || plan.status === "pencilled") {
    return canPlan ? "plan" : null;
  }
  if (
    canPropose &&
    isLoneProposal(plan, plans) &&
    plan.createdById != null &&
    (plan.createdById === currentUser?.id || Boolean(currentUser?.isOwner))
  ) {
    return "contest";
  }
  return null;
}
