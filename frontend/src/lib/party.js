// Who a plan is for. Mirrors backend/app/party.py — read that module's
// docstring for the model; the short version is:
//
// A plan's `party` is a list of contributor ids, and [] means everyone on
// the trip. The group splitting up for a morning is nothing more than two
// plans at the same time for people who don't overlap, so every rule
// here is about comparing two of those lists.

// A stable key for grouping: "" for everyone, else the sorted ids.
export function partyKey(party) {
  const ids = party ?? [];
  return ids.length ? [...ids].sort((a, b) => a - b).join(",") : "";
}

// Would someone be on both? Everyone ([]) is on everything. Same rule as
// backend/app/party.py parties_meet — the grid's own overlap checks have
// to agree with the server's or a drag the grid allows comes back a 409.
export function partiesMeet(a, b) {
  const x = a ?? [];
  const y = b ?? [];
  if (!x.length || !y.length) return true;
  return x.some((id) => y.includes(id));
}

export function isForEveryone(plan) {
  return !(plan?.party ?? []).length;
}

export function planIncludes(plan, contributorId) {
  const party = plan?.party ?? [];
  return !party.length || party.includes(contributorId);
}

// The contributors on a party, in roster order. [] is the whole roster.
export function partyMembers(party, contributors) {
  const ids = party ?? [];
  if (!ids.length) return contributors;
  return contributors.filter((c) => ids.includes(c.id));
}

// "Ana", "Ana and Lin", "Mei, Jae and Theo".
export function namesOf(people) {
  const names = people.map((p) => p.name);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
