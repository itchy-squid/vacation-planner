import { test, expect } from "../support/fixtures.js";
import { placePlan, plansOf, contestsOf, setDayPlaces, travelItemsOf, clockOf } from "../support/seed.js";

// Planning a trip from the Map tab (pages/PlanTrip.jsx, lib/tripPlan.js):
//   - stops in order with a ride between each pair, from where the group is
//     staying (a day's "Staying at" idea) and back
//   - a trip with a new stop goes to review and then a vote: every ride and
//     every new stop in one block, never the hotel
//   - a trip whose stops are all on the calendar already puts its rides
//     straight there, filling the gaps
// Markers only exist on a real map, and ride times come from Google's
// Routes API, so these skip without a Maps key (or without Routes).

const HOTEL = { title: "Hotel Playa", region: "Playa del Carmen", lat: 20.6296, lng: -87.0739 };
const COBA = { title: "Cobá Ruins", region: "Cobá", lat: 20.4947, lng: -87.7361, minutes: 150 };
const CENOTE = { title: "Cenote Dos Ojos", region: "Tulum", lat: 20.3272, lng: -87.3906, minutes: 120 };
const TULUM = { title: "Tulum Ruins", region: "Tulum", lat: 20.215, lng: -87.429, minutes: 180 };

async function stayAtHotel(api, trip) {
  await setDayPlaces(api, trip, { 1: { stay: HOTEL.region, lodging: trip.pins[HOTEL.title] } });
}

async function openMap(page, trip) {
  await page.goto(`/trips/${trip.id}/map`);
  const map = page.getByRole("region", { name: "Trip map" });
  await expect(map).toHaveAttribute("data-map-state", /^(ready|unconfigured)$/, { timeout: 20_000 });
  test.skip((await map.getAttribute("data-map-state")) !== "ready", "This environment has no Maps key.");
}

// Waits for Google's ride times; skips when Routes isn't enabled on the key.
async function waitForRides(page, cta) {
  const failed = page.getByText("Couldn’t get times from Google.").first();
  await expect(cta.or(failed)).toBeVisible({ timeout: 30_000 });
  test.skip(await failed.isVisible(), "The Maps key can't reach the Routes API.");
  await expect(cta).toBeEnabled({ timeout: 30_000 });
}

test("hotel → two new places → hotel goes to a vote as one block", async ({ page, api, seed }) => {
  const trip = await seed({ pins: [HOTEL, COBA, CENOTE] });
  await stayAtHotel(api, trip);
  await openMap(page, trip);

  await page.getByRole("button", { name: COBA.title }).click({ timeout: 20_000 });
  await page.getByRole("button", { name: "Directions" }).click();
  await expect(page).toHaveURL(new RegExp(`/map/trip\\?to=${trip.pins[COBA.title]}`));

  // Starts where the group is staying, and ends back there.
  const timeline = page.getByRole("list", { name: "Trip" });
  await expect(timeline.getByText("Where you’re staying · you start here")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: `End at ${HOTEL.title}` })).toBeChecked();

  await page.getByRole("button", { name: "+ Add a stop" }).click();
  await page.getByRole("button", { name: /^Tap a place on the map/ }).click();
  await page.getByRole("button", { name: `Add ${CENOTE.title}` }).click();

  const review = page.getByRole("button", { name: "Review proposal" });
  await waitForRides(page, review);
  // Every ride can change how it goes.
  await timeline.getByRole("button", { name: new RegExp(`to ${COBA.title}, .* Change how`) }).click();
  await expect(page.getByRole("group", { name: `How to get to ${COBA.title}` }).getByRole("button", { name: /^Car, / })).toBeVisible();

  await review.click();
  await expect(page.getByLabel("Name this proposal")).toHaveValue(`${COBA.title} & ${CENOTE.title}`);
  await page.getByRole("button", { name: "Send to vote" }).click();
  await expect(page).toHaveURL(/\/contests\/\d+/, { timeout: 20_000 });

  const [contest] = await contestsOf(api, trip);
  const [proposal] = contest.plans;
  const stops = proposal.items.map((i) => (i.pin ? i.pin.title : `ride:${i.travel_item.mode}`));
  // Ride, Cobá, ride, cenote, ride — and no hotel.
  expect(stops).toHaveLength(5);
  expect(stops.filter((s) => !s.startsWith("ride:"))).toEqual([COBA.title, CENOTE.title]);
  expect(stops.filter((s) => s.startsWith("ride:"))).toHaveLength(3);
});

test("rides between places already on the calendar go straight onto it", async ({ page, api, seed }) => {
  const trip = await seed({ pins: [HOTEL, TULUM] });
  await stayAtHotel(api, trip);
  await placePlan(api, trip, { day: 1, from: "11:00", to: "14:00", pin: trip.pins[TULUM.title] });
  await openMap(page, trip);

  await page.getByRole("button", { name: TULUM.title }).click({ timeout: 20_000 });
  await page.getByRole("button", { name: "Directions" }).click();
  await expect(page.getByText(`Timed around ${TULUM.title} at 11:00`)).toBeVisible();

  const add = page.getByRole("button", { name: "Add 2 rides to Day 1" });
  await waitForRides(page, add);
  await add.click();
  await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}/schedule/1`), { timeout: 20_000 });

  const rides = (await plansOf(api, trip)).filter((p) => p.items[0]?.travel_item);
  expect(rides.map((p) => p.status)).toEqual(["placed", "placed"]);
  expect(rides.map((p) => clockOf(p.end_min))).toContain("11:00");
  expect(rides.map((p) => clockOf(p.start_min))).toContain("14:00");
  expect((await travelItemsOf(api, trip)).every((t) => t.kind === "travel" && t.mode)).toBe(true);
});

test("without anywhere to stay, a trip starts where you say", async ({ page, seed }) => {
  const trip = await seed({ pins: [COBA, CENOTE] });
  await openMap(page, trip);

  await page.getByRole("button", { name: CENOTE.title }).click({ timeout: 20_000 });
  await page.getByRole("button", { name: "Directions" }).click();
  await expect(page.getByText("Tap where the trip starts")).toBeVisible();
  await page.getByRole("button", { name: `Add ${COBA.title}` }).click();

  // Both are new, so both are proposed; there's no hotel to go back to.
  await expect(page.getByRole("checkbox", { name: /^End at/ })).toHaveCount(0);
  await waitForRides(page, page.getByRole("button", { name: "Review proposal" }));
  await expect(page.getByRole("list", { name: "Trip" }).getByText("New stop · proposed", { exact: false })).toHaveCount(2);
});
