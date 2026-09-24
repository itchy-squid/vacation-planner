// Seed data, made through the public API as the test account -- the same
// calls the app makes, so seeding can't reach anything the account couldn't.
import { ok } from "./api.js";
import { RUN_ID, TRIP_PREFIX } from "./env.js";

// Day 1 of every seeded trip. Plans store trip-local wall-clock time.
export const TRIP_START = "2026-10-03";
const TRIP_END = "2026-10-06";

export function at(day, clock) {
  const [h, m] = clock.split(":").map(Number);
  const d = new Date(`${TRIP_START}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + day - 1);
  d.setUTCHours(h, m);
  return d.toISOString().replace(".000Z", "");
}

/**
 * A fresh trip owned by the test account (who is also its first traveler,
 * as for any new trip), plus whatever the test asks for.
 *
 *   travelers: ["Ana", "Lin"]            extra travelers, no accounts
 *   pins:      [{ title, region, minutes }]
 *   events:    [{ title, minutes }]      custom events (travel items)
 *
 * Returns ids by name: { id, name, me, travelers: { Ana: 12 }, pins: {...}, events: {...} }.
 */
export async function seedTrip(api, { title = "trip", travelers = [], pins = [], events = [] } = {}) {
  const name = `${TRIP_PREFIX}${title} · ${RUN_ID}`;
  const trip = await ok(
    api.post("/api/trips", { data: { name, region_line: "Taipei", start_date: TRIP_START, end_date: TRIP_END } }),
    "create trip"
  );
  const seeded = { id: trip.id, name, me: trip.my_traveler_id, travelers: {}, pins: {}, events: {} };

  for (const traveler of travelers) {
    const row = await ok(api.post(`/api/trips/${trip.id}/travelers`, { data: { name: traveler } }), `add traveler ${traveler}`);
    seeded.travelers[traveler] = row.id;
  }
  for (const pin of pins) {
    const row = await ok(
      api.post(`/api/trips/${trip.id}/pins`, {
        data: {
          title: pin.title,
          short: pin.short ?? pin.title,
          place: pin.place ?? pin.region ?? "Taipei",
          region: pin.region ?? "Taipei",
          duration_minutes: pin.minutes ?? 60,
        },
      }),
      `add pin ${pin.title}`
    );
    seeded.pins[pin.title] = row.id;
  }
  for (const event of events) {
    const row = await ok(
      api.post(`/api/trips/${trip.id}/travel-items`, { data: { title: event.title, duration_minutes: event.minutes ?? 60 } }),
      `add custom event ${event.title}`
    );
    seeded.events[event.title] = row.id;
  }
  return seeded;
}

// Put something straight on the calendar: { pin } or { event }, by id.
// `branch` puts it in one group of a split (see splitDay below).
export async function placePlan(api, trip, { day = 1, from, to, pin, event, branch = null }) {
  return ok(
    api.post(`/api/trips/${trip.id}/plans`, {
      data: {
        starts_at: at(day, from),
        ends_at: at(day, to),
        status: "placed",
        items: [pin != null ? { pin_id: pin } : { travel_item_id: event }],
        branch_id: branch,
      },
    }),
    "place plan"
  );
}

// Split the group over some hours: `groups` is [{ label, travelers: [ids] }]
// in order. Returns the split, whose `branches` carry the ids placePlan's
// `branch` takes.
export async function splitDay(api, trip, { day = 1, from, to, groups }) {
  return ok(
    api.post(`/api/trips/${trip.id}/splits`, {
      data: {
        starts_at: at(day, from),
        ends_at: at(day, to),
        branches: groups.map((g) => ({ label: g.label ?? "", traveler_ids: g.travelers })),
      },
    }),
    "split the group"
  );
}

export async function splitsOf(api, trip) {
  return ok(api.get(`/api/trips/${trip.id}/splits`), "list splits");
}

export async function contestsOf(api, trip) {
  const plans = await plansOf(api, trip);
  const ids = [...new Set(plans.filter((p) => p.contest_id != null).map((p) => p.contest_id))];
  return Promise.all(ids.map((id) => ok(api.get(`/api/contests/${id}`), "get contest")));
}

export async function plansOf(api, trip) {
  return ok(api.get(`/api/trips/${trip.id}/plans`), "list plans");
}

export async function travelItemsOf(api, trip) {
  return ok(api.get(`/api/trips/${trip.id}/travel-items`), "list travel items");
}
