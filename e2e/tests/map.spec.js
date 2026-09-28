import { test, expect } from "../support/fixtures.js";

// The Map tab. Whether Google actually draws depends on the environment:
// dev has a Maps key, a local stack usually doesn't. Either is a working
// screen; a failed load or a key Google refuses is not.
const WORKING = /^(ready|unconfigured)$/;

test("the Map tab opens the trip's map", async ({ page, seed }) => {
  const trip = await seed({ pins: [{ title: "Raohe Night Market", region: "Taipei" }] });
  await page.goto(`/trips/${trip.id}/board`);

  await page.getByRole("link", { name: "Map", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}/map$`));
  await expect(page.getByRole("link", { name: "Map", exact: true })).toHaveAttribute("aria-current", "page");

  const map = page.getByRole("region", { name: "Trip map" });
  await expect(map).toBeVisible();
  await expect(map).toHaveAttribute("data-map-state", WORKING, { timeout: 20_000 });
});

test("the map keeps the trip header and stops above the tab bar", async ({ page, seed }) => {
  const trip = await seed();
  await page.goto(`/trips/${trip.id}/map`);

  await expect(page.getByText(trip.name)).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to Trips home" })).toBeVisible();

  // Google's logo and attribution live in the map's bottom corners, so the
  // tab bar mustn't cover them.
  const map = page.getByRole("region", { name: "Trip map" });
  const tabs = page.getByRole("link", { name: "Ideas", exact: true });
  const mapBox = await map.boundingBox();
  const tabBox = await tabs.boundingBox();
  expect(mapBox.y + mapBox.height).toBeLessThanOrEqual(tabBox.y + 1);

  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflows).toBe(false);
});
