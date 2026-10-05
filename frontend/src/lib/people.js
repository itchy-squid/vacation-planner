// Helpers for the people you've planned with (GET /api/people — see
// backend/app/routers/people.py). Each person carries the trips you
// shared, most recent first, with their role on each.

import { GRANTABLE_ROLES } from "./roles.js";

// The trips behind the people list, each with everyone you shared it
// with: the "Everyone from a trip" chips on the new-trip form and the
// filter chips on People. Most recent first, in the order the people
// list already gives each person's trips.
export function tripGroups(people) {
  const groups = new Map();
  for (const person of people) {
    for (const trip of person.trips) {
      if (!groups.has(trip.id)) {
        groups.set(trip.id, { id: trip.id, name: trip.name, startDate: trip.start_date, emails: [] });
      }
      groups.get(trip.id).emails.push(person.email);
    }
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
