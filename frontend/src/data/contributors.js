// NOTE: no longer imported anywhere in the app — contributors now come from the
// real backend (see state/PlannerContext.jsx, which fetches and normalizes
// them). Kept only as a readable record of the original sample content this
// project shipped with; backend/app/seed.py has its own copy of the same
// values for populating the database, independent of this file.

// Contributor identity tints are desaturated and assigned by join order —
// they never carry status (see design_system/readme.md, "Colour").
export const CONTRIBUTORS = [
  { id: "mei", name: "Mei", initial: "M", tint: "var(--who-1)", isOwner: true },
  { id: "jae", name: "Jae", initial: "J", tint: "var(--who-2)", isOwner: false },
  { id: "ana", name: "Ana", initial: "A", tint: "var(--who-3)", isOwner: false },
  { id: "lin", name: "Lin", initial: "L", tint: "var(--who-4)", isOwner: false },
];

// "+2" more contributors the design references ("6 planning") without
// naming — represented as an overflow bubble, not real records yet.
export const CONTRIBUTOR_OVERFLOW_COUNT = 2;
export const TOTAL_CONTRIBUTOR_COUNT = CONTRIBUTORS.length + CONTRIBUTOR_OVERFLOW_COUNT;

export function contributorById(id) {
  return CONTRIBUTORS.find((c) => c.id === id) ?? null;
}
