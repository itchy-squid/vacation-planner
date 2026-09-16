// The four roles someone can hold on a trip, and the words the app uses
// for each. What a role may actually do is backend/app/permissions.py;
// screens ask useCan() for a scope rather than checking the role name.
//
//   reader    — follows along
//   companion — going on the trip: suggests ideas and blocks, votes,
//               comments; sees only the costs on ideas they added
//   planner   — runs the plan: everything, including every expense
//   owner     — a planner who also decides and manages the trip
//
// "planner" was called "contributor" before companions existed. The member
// record is still a "contributor" in the API (/contributors, contributor_id).

export const ROLES = {
  owner: {
    label: "Owner",
    access: "You run this trip.",
  },
  planner: {
    label: "Planner",
    invite: "Sees everything, including expenses. Can add and edit any idea, plan days, propose blocks and vote.",
    access: "You can add ideas, plan days, propose blocks, vote and see expenses.",
    joinPoints: [
      [true, "See everything on the trip, including expenses"],
      [true, "Add and edit ideas, places and travel items"],
      [true, "Plan days, propose blocks and vote"],
      [false, "Trip settings and invites stay with the owner"],
    ],
  },
  companion: {
    label: "Companion",
    invite: "Can add ideas, propose blocks, vote and comment. Can't put things on the calendar directly or see trip expenses.",
    access:
      "You can add ideas, propose blocks, vote and comment. You see the cost only on ideas you added.",
    joinPoints: [
      [true, "Add ideas, with a cost if you know it"],
      [true, "Propose blocks for the calendar, vote and comment"],
      [false, "Planners put things on the calendar"],
      [false, "Trip expenses stay hidden"],
    ],
  },
  reader: {
    label: "Reader",
    invite: "Sees ideas, the plan, votes and the itinerary. Can't change anything, vote, or see expenses.",
    access: "You can see ideas, the plan, votes and the itinerary.",
    joinPoints: [
      [true, "See ideas, the day plan and the itinerary"],
      [true, "Follow proposals and votes as they happen"],
      [false, "No adding, editing, voting or comments"],
      [false, "Expenses stay hidden"],
    ],
  },
};

// Roles the owner can hand out, most access first — the order of the
// invite sheet and the people list's picker.
export const GRANTABLE_ROLES = ["planner", "companion", "reader"];

export function roleLabel(role) {
  return ROLES[role]?.label ?? "Planner";
}
