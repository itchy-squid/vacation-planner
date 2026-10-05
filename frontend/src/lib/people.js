// Helpers for the people you've planned with (GET /api/people — see
// backend/app/routers/people.py). Each person carries the trips you
// shared, most recent first, with their role on each.

import { GRANTABLE_ROLES } from "./roles.js";

// The trips behind the people list, each with everyone you shared it
// with: the "Everyone from a trip" chips on the new-trip form and the
// filter chips on People. Most recent first, in the order the people
// list already gives each person's trips. Past travelers without an
// account (GET /api/people/travelers), when given, are counted in their
// trips too, by `key`.
export function tripGroups(people, pastTravelers = []) {
  const groups = new Map();
  const groupFor = (trip) => {
    if (!groups.has(trip.id)) {
      groups.set(trip.id, { id: trip.id, name: trip.name, startDate: trip.start_date, emails: [], travelerKeys: [] });
    }
    return groups.get(trip.id);
  };
  for (const person of people) {
    for (const trip of person.trips) groupFor(trip).emails.push(person.email);
  }
  for (const traveler of pastTravelers) {
    for (const trip of traveler.trips) groupFor(trip).travelerKeys.push(traveler.key);
  }
  return [...groups.values()].sort((a, b) => {
    // Undated trips sort as oldest; ids break ties so the order is stable.
    const byDate = (b.startDate ?? "").localeCompare(a.startDate ?? "");
    return byDate !== 0 ? byDate : b.id - a.id;
  });
}

// "Taiwan, Peru" — the trips you shared, most recent first, capped so a
// long history doesn't wrap the row.
export function sharedTripsLine(person, max = 3) {
  const names = person.trips.map((t) => t.name);
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} +${names.length - max}`;
}

// Search by name or email, ignoring case and surrounding spaces.
export function matchesQuery(person, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return person.display_name.toLowerCase().includes(q) || person.email.toLowerCase().includes(q);
}

// The role a new invite suggests: whatever they had on the last trip you
// shared. An owner there becomes a planner here, since a trip has one
// owner and it's you.
export function suggestedRole(person) {
  return GRANTABLE_ROLES.includes(person.last_role) ? person.last_role : "planner";
}

export function firstName(person) {
  return person.display_name.trim().split(/\s+/)[0] || person.display_name;
}

// Who a listed traveler on a new trip is paid for by, given who's going:
// "me", someone invited and coming (their email), or null for their own
// way. A payer who isn't coming hands the bill to you, the trip's
// creator, rather than leaving someone who was paid for paying alone.
export function resolvePayer(paidBy, chosen) {
  if (paidBy == null || paidBy === "me") return paidBy ?? null;
  return chosen[paidBy]?.traveling ? paidBy : "me";
}

// The payer a past traveler starts with: whoever paid last time.
export function lastPayer(traveler) {
  if (traveler.paid_by_you) return "me";
  return traveler.paid_by_email ?? null;
}

// Listed travelers a person invited to an existing trip could swap in
// for: on the roster, not on the app, and not already kept for another
// invite. `taken` is the traveler ids already spoken for.
export function openSpots(travelers, taken = new Set()) {
  return travelers.filter((t) => t.contributorId == null && !taken.has(t.id));
}

// The listed traveler someone is most likely already down as: the one
// open spot with their first name, when there's exactly one. "Jonah"
// matches Jonah Reyes; two Jonahs, or none, match nobody.
export function sameNameSpot(person, spots) {
  const first = firstName(person).toLowerCase();
  const matches = spots.filter((t) => (t.name.trim().split(/\s+/)[0] || "").toLowerCase() === first);
  return matches.length === 1 ? matches[0] : null;
}
