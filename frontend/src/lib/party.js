// Who a plan is for. Mirrors backend/app/party.py — read that module's
// docstring for the model. In short: a plan's party is a set of
// travelers, stored as ids plus a mode — "only" these, or "except" these
// (everyone else, including anyone added to the trip later). Everyone is
// "except" nobody.
//
// The client never has to apply that rule itself: every plan and contest
// arrives with `partyMembers` (the travelers it comes to right now) and
// `forEveryone`. Everything here reads those.

// A stable key for grouping plans by who they're for.
export function partyKey(plan) {
  if (!plan || plan.forEveryone) return "";
  return `${plan.partyMode}:${[...(plan.party ?? [])].sort((a, b) => a - b).join(",")}`;
}

// Would someone be on both? Same rule as backend/app/party.py
// parties_meet: two "except" parties always meet (the next person added
// would be on both); otherwise it's whether their travelers overlap.
export function partiesMeet(a, b) {
  if (!a || !b) return true;
  if (a.partyMode === "except" && b.partyMode === "except") return true;
  const ids = new Set(a.partyMembers ?? []);
  return (b.partyMembers ?? []).some((id) => ids.has(id));
}

export function isForEveryone(plan) {
  return plan?.forEveryone ?? true;
}

// Whether a traveler is on a plan. A viewer who isn't travelling (null)
// is on nothing but plans for everyone.
export function planIncludes(plan, travelerId) {
  if (!plan || plan.forEveryone) return true;
  return travelerId != null && (plan.partyMembers ?? []).includes(travelerId);
}

// Whether people added to the trip later land on this plan: its party is
// "everyone except …" but not simply everyone.
export function takesNewcomers(plan) {
  return Boolean(plan && !plan.forEveryone && plan.partyMode === "except");
}

// The travelers on a plan (or any { partyMembers, forEveryone }), in
// roster order.
export function membersOf(plan, travelers) {
  if (!plan || plan.forEveryone) return travelers;
  const ids = new Set(plan.partyMembers ?? []);
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
