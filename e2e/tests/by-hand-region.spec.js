import { test, expect } from "../support/fixtures.js";
import { ok } from "../support/api.js";

// Ideas Google Maps doesn't list, like a tour booked on Viator
// (components/newpin/ByHandForm.jsx): added by hand, they show on the Map
// tab in their region, and an exact spot can be pinned later
// (pages/TripMap.jsx). Region lookups need the Maps key (dev has one), so
// the map parts skip without it.

const VIATOR = "https://www.viator.com/tours/Cozumel/Snorkel-and-Beach-Break/d632-5512P3";

async function openByHand(page, trip) {
  await page.goto(`/trips/${trip.id}/board`);
  await page.getByRole("button", { name: "Add pin" }).click();
  // With search, "Add it by hand" is under the results; without a Maps key
  // the "+" opens the by-hand form directly.
  const byHand = page.getByRole("button", { name: /Add it by hand/ });
  if (await byHand.count()) await byHand.click();
  await expect(page.getByLabel("Link", { exact: true })).toBeVisible();
}

const hasMap = async (page) => (await page.getByRole("region", { name: "Where it will show" }).count()) > 0;

test("a Viator link fills in the title and picks the region", async ({ page, seed }) => {
  const trip = await seed({ pins: [{ title: "Chankanaab Beach Park", region: "Cozumel" }] });
  await openByHand(page, trip);

  await page.getByLabel("Link", { exact: true }).fill(VIATOR);
  await expect(page.getByLabel("Title")).toHaveValue("Snorkel and Beach Break");
  await expect(page.getByRole("button", { name: "Cozumel", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("an idea Google doesn't list is added in its region and shows there on the map", async ({ page, api, seed }) => {
  const trip = await seed({ pins: [{ title: "Chankanaab Beach Park", region: "Cozumel" }] });
  await openByHand(page, trip);
  test.skip(!(await hasMap(page)), "This environment has no Maps key, so regions can't be found on the map.");

  await page.getByLabel("Link", { exact: true }).fill(VIATOR);
  await expect(page.getByText("Shown in Cozumel").first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Add to board" }).click();

  await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}/board$`));
  await expect(page.getByRole("status")).toContainText("Snorkel and Beach Break added to ideas");
  await expect(page.getByText("Shown in Cozumel").first()).toBeVisible();

  const pins = await ok(api.get(`/api/trips/${trip.id}/pins`), "list pins");
  const tour = pins.find((p) => p.title === "Snorkel and Beach Break");
  expect(tour).toMatchObject({ region: "Cozumel", lat: null, lng: null, link: VIATOR });
  const regions = await ok(api.get(`/api/trips/${trip.id}/regions`), "list regions");
  expect(regions.map((r) => r.name)).toContain("Cozumel");

  // Both ideas are in Cozumel's badge on the Map tab.
  await page.getByRole("link", { name: "Map", exact: true }).click();
  await expect(page.getByText("2 of 2 ideas on the map")).toBeVisible({ timeout: 20_000 });
});

test("an idea shown by region can be pinned to an exact spot from the Map tab", async ({ page, api, seed }) => {
  const trip = await seed({ pins: [{ title: "Chankanaab Beach Park", region: "Cozumel" }] });
  const pinId = trip.pins["Chankanaab Beach Park"];
  await page.goto(`/trips/${trip.id}/map`);
  const map = page.getByRole("region", { name: "Trip map" });
  await expect(map).toHaveAttribute("data-map-state", /^(ready|unconfigured)$/, { timeout: 20_000 });
  test.skip((await map.getAttribute("data-map-state")) !== "ready", "This environment has no Maps key.");

  await expect(page.getByText("1 of 1 ideas on the map")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Cozumel" }).click();
  await page.getByRole("button", { name: "Pin a spot" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Tap the map where" })).toBeVisible();
  // Away from the middle, where Cozumel's badge is, and clear of the
  // header and the "Tap the map" banner at the top.
  const box = await map.boundingBox();
  await map.click({ position: { x: box.width * 0.2, y: box.height * 0.75 } });

  await expect(page.getByText("Chankanaab Beach Park is pinned.")).toBeVisible();
  const pin = await ok(api.get(`/api/pins/${pinId}`), "read pin");
  expect(pin.lat).toEqual(expect.any(Number));
  expect(pin.google_place_id).toBeNull();
});
