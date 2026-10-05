// Seed data, made through the public API as the test account -- the same
// calls the app makes, so seeding can't reach anything the account couldn't.
import { ok } from "./api.js";
import { RUN_ID, TRIP_PREFIX } from "./env.js";

// Day 1 of every seeded trip. Plans store a trip minute: minutes from
// 00:00 on day 1, wall-clock time wherever the trip is.
export const TRIP_START = "2026-10-03";
const TRIP_END = "2026-10-06";

/** The trip minute for "HH:MM" on day `day` (1-based). */
export function at(day, clock) {
  const [h, m] = clock.split(":").map(Number);
  return (day - 1) * 1440 + h * 60 + m;
}

/** "HH:MM" for a trip minute, whatever day it's on. */
export function clockOf(minute) {
  const within = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(within / 60)).padStart(2, "0")}:${String(within % 60).padStart(2, "0")}`;
}

/**
 * A fresh trip owned by the test account (who is also its first traveler,
 * as for any new trip), plus whatever the test asks for.
 *
 *   travelers: ["Ana", "Lin"]            extra travelers, no accounts
 *   pins:      [{ title, region, minutes, hearted, lat, lng, placeId, photoUrl }]
 *              hearted: the test account hearts it; lat/lng (and placeId):
 *              an exact spot, as if it had been found by place search;
 *              photoUrl: the pin's photo
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
          place: pin.place ?? pin.region ?? "Taipei",
          region: pin.region ?? "Taipei",
          duration_minutes: pin.minutes ?? 60,
          ...(pin.lat != null ? { lat: pin.lat, lng: pin.lng, google_place_id: pin.placeId ?? null } : {}),
          ...(pin.photoUrl ? { photo_url: pin.photoUrl } : {}),
        },
      }),
      `add pin ${pin.title}`
    );
    seeded.pins[pin.title] = row.id;
    if (pin.hearted) await ok(api.put(`/api/pins/${row.id}/heart`), `heart pin ${pin.title}`);
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
        start_min: at(day, from),
        end_min: at(day, to),
        status: "placed",
        items: [pin != null ? { pin_id: pin } : { travel_item_id: event }],
        branch_id: branch,
      },
    }),
    "place plan"
  );
}

// Put a proposal up for a vote over some hours: `pins` / `events` are the
// set's stops, by id, packed from `from`. Returns the contest. Anything
// already in those hours becomes the "on the board" option it competes
// with (backend/app/routers/contests.py open_block_contest).
export async function proposeBlock(api, trip, { day = 1, from, to, pins = [], events = [] }) {
  return ok(
    api.post(`/api/trips/${trip.id}/contests`, {
      data: {
        start_min: at(day, from),
        end_min: at(day, to),
        items: [...pins.map((id) => ({ pin_id: id })), ...events.map((id) => ({ travel_item_id: id }))],
      },
    }),
    "propose block"
  );
}

// Split the group over some hours: `groups` is [{ label, travelers: [ids] }]
// in order. Returns the split, whose `branches` carry the ids placePlan's
// `branch` takes.
export async function splitDay(api, trip, { day = 1, from, to, groups }) {
  return ok(
    api.post(`/api/trips/${trip.id}/splits`, {
      data: {
        start_min: at(day, from),
        end_min: at(day, to),
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

export async function pinsOf(api, trip) {
  return ok(api.get(`/api/trips/${trip.id}/pins`), "list pins");
}

export async function plansOf(api, trip) {
  return ok(api.get(`/api/trips/${trip.id}/plans`), "list plans");
}

// "Where we'll be": { 1: { stay, lodging, visits } } for the days of the
// trip to set (backend routers/day_places.py); `lodging` is the id of the
// pin the group is staying at.
export async function setDayPlaces(api, trip, days) {
  const body = Object.entries(days).map(([number, day]) => ({
    day: Number(number),
    stay: day.stay ?? null,
    lodging_pin_id: day.lodging ?? null,
    visits: day.visits ?? [],
  }));
  return ok(api.put(`/api/trips/${trip.id}/day-places`, { data: { days: body } }), "set day places");
}

export async function dayPlacesOf(api, trip) {
  return ok(api.get(`/api/trips/${trip.id}/day-places`), "list day places");
}

export async function travelItemsOf(api, trip) {
  return ok(api.get(`/api/trips/${trip.id}/travel-items`), "list travel items");
}
