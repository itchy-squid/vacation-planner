// One definition of "does this pin work on this day, in this band".
//
// It lived inline in components/planner/AvailabilityGrid.jsx until the
// propose-a-block flow needed the same answer for its "Pull in" list
// (docs/features/proposals-and-expenses-feature-spec.md §5.3). Two
// spellings of the same rule is exactly the trap the feature spec's
// "Derived values" section describes for slack — a voter reading "works"
// on one screen and a hatched cell on another, five seconds apart — so
// both callers come through here.
//
// Currency note: `day` is a **calendar day-of-month** (data/trip.js
// getTripDays' `d.n`), not a 1-based trip day index. That is what
// AvailabilityRule.days and the override keys have always held; see
// pages/EditVisit.jsx for the conversion from a trip-relative dayIndex.

// A rule constrains an axis only when it actually lists something on it.
// PlannerContext.normalizePin hands every pin a rule object — `{days:
// null, bands: null, why: []}` when the pin has none — so an "is there a
// rule" check can't be a null check, and each axis has to be read on its
// own. Per data/pins.js: "A pin with no rule is treated as available
// every day/band (nothing ties it down yet)."
export function ruleAllows(rule, day, band) {
  if (!rule) return true;
  const dayOk = !rule.days || rule.days.length === 0 || rule.days.includes(day);
  const bandOk = !rule.bands || rule.bands.length === 0 || rule.bands.includes(band);
  return dayOk && bandOk;
}

export function overrideKey(pinId, day, band) {
  return `${pinId}|${day}-${band}`;
}

// A contributor's override flips whatever the rule said for that one cell
// — it's a toggle, not an "available" flag, which is why it reads as
// `!base` rather than `true`.
export function worksOn(pinId, rule, overrides, day, band) {
  const base = ruleAllows(rule, day, band);
  return overrides?.[overrideKey(pinId, day, band)] ? !base : base;
}

// A claimed window can straddle bands (13:00–20:00 is PM and EVE). A pin
// qualifies if it works in *any* band the window touches, because the
// stop only has to fit somewhere inside the block: a PM-only pin is a
// perfectly good stop in a mostly-PM block. Requiring every band would
// rule it out, which reads as a bug to the person who can see the free
// hours right there in the list.
export function worksInAnyBand(pinId, rule, overrides, day, bands) {
  return bands.some((band) => worksOn(pinId, rule, overrides, day, band));
}

// The distinct reasons behind a rule, for surfacing next to anything shown
// as ruled out — design_system readme "Content fundamentals": explain
// restrictions, never just assert them.
export function reasonsFor(rule) {
  return rule?.why?.length ? [...new Set(rule.why)] : [];
}
