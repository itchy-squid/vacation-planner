import { test, expect } from "../support/fixtures.js";
import { ok } from "../support/api.js";

// Adding an idea by searching for it (pages/NewPin.jsx): the board's "+"
// opens search with the map on top, picking a place fills in the form, and
// adding it goes back to the board. Search needs the Maps key (dev has
// one), so the tests that search skip without it.

const boardUrl = (trip) => `/trips/${trip.id}/board`;
const QUERY = "Longshan Temple Taipei";

async function openSearch(page, trip) {
  await page.goto(boardUrl(trip));
  await page.getByRole("button", { name: "Add pin" }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}/new-pin$`));
  return page.getByRole("searchbox", { name: "Search for a place" });
}

async function skipWithoutSearch(page) {
  const box = page.getByRole("searchbox", { name: "Search for a place" });
  test.skip((await box.count()) === 0, "This environment has no Maps key, so there's no place search.");
}

test("a place found by search is added with where it is, and searching again offers the idea", async ({ page, api, seed }) => {
  const trip = await seed({ pins: [{ title: "Raohe Night Market", region: "Taipei" }] });
  const box = await openSearch(page, trip);
  await skipWithoutSearch(page);

  await expect(box).toBeFocused();
  await expect(page.getByRole("region", { name: "Search map" })).toBeVisible();
  await box.fill(QUERY);

  const results = page.getByRole("list", { name: "Places found" });
  const first = results.getByRole("listitem").first();
  await expect(first).toContainText("Longshan", { timeout: 20_000 });
  await first.getByRole("button").first().click();
  await page.getByRole("button", { name: "Add this place" }).click();

  // The form arrives filled in from the place.
  const title = page.getByLabel("Title");
  await expect(title).toHaveValue(/Longshan/);
  await expect(page.getByRole("link", { name: /in Google Maps/ })).toBeVisible();
  const added = await title.inputValue();
  await page.getByRole("button", { name: "Add to board" }).click();

  // Back on the board, announced.
  await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}/board$`));
  await expect(page.getByRole("status")).toContainText(`${added} added to ideas`);

  const pins = await ok(api.get(`/api/trips/${trip.id}/pins`), "list pins");
  const pin = pins.find((p) => p.title === added);
  expect(pin.lat).toEqual(expect.any(Number));
  expect(pin.lng).toEqual(expect.any(Number));
  expect(pin.google_place_id).toBeTruthy();
  expect(pin.link).toContain("google.com/maps");

  // The same search again finds it's already an idea, and opens that.
  await page.getByRole("button", { name: "Add pin" }).click();
  await page.getByRole("searchbox", { name: "Search for a place" }).fill(QUERY);
  const again = page.getByRole("list", { name: "Places found" }).getByRole("listitem").filter({ hasText: "AN IDEA" });
  await expect(again).toHaveCount(1, { timeout: 20_000 });
  await again.getByRole("button").first().click();
  await page.getByRole("button", { name: "Open idea" }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}/edit/${pin.id}`));
});

test("going back from the form keeps the search", async ({ page, seed }) => {
  const trip = await seed({ pins: [{ title: "Raohe Night Market", region: "Taipei" }] });
  const box = await openSearch(page, trip);
  await skipWithoutSearch(page);

  await box.fill(QUERY);
  const first = page.getByRole("list", { name: "Places found" }).getByRole("listitem").first();
  await expect(first).toContainText("Longshan", { timeout: 20_000 });
  await first.getByRole("button").first().click();
  await page.getByRole("button", { name: "Add this place" }).click();
  await page.getByRole("button", { name: "‹ Search" }).click();

  await expect(page.getByRole("searchbox", { name: "Search for a place" })).toHaveValue(QUERY);
  await expect(page.getByRole("list", { name: "Places found" }).getByRole("listitem").first()).toContainText("Longshan");
});

test("a place search can't find can still be added by hand", async ({ page, seed }) => {
  const trip = await seed({ pins: [{ title: "Raohe Night Market", region: "Taipei" }] });
  await openSearch(page, trip);

  // With search, it's a button under the results; without a Maps key the
  // "+" opens the by-hand form directly.
  const byHand = page.getByRole("button", { name: /Add it by hand/ });
  if (await byHand.count()) await byHand.click();

  await expect(page.getByLabel("Link", { exact: true })).toBeVisible();
  await page.getByLabel("Title").fill("Auntie's dumplings");
  await page.getByRole("button", { name: "Add to board" }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}/board$`));
  await expect(page.getByRole("status")).toContainText("Auntie's dumplings added to ideas");
});

test("Type a place on the empty board opens search", async ({ page, seed }) => {
  const trip = await seed();
  await page.goto(boardUrl(trip));
  await page.getByRole("button", { name: /^Type a place/ }).click();
  await skipWithoutSearch(page);

  await expect(page.getByRole("searchbox", { name: "Search for a place" })).toBeFocused();
});
