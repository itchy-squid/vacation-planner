import { test, expect } from "../support/fixtures.js";
import { ok } from "../support/api.js";

// Linking an idea that was added without its place (by hand, or before
// place search) to the place Google knows it as: from the idea's screen,
// from the Map tab's region list, and in the "On Google Maps?" review.
// Linking gives the idea its exact spot and Google place, and leaves its
// title alone. These use real Google searches, so they skip without the
// Maps key (dev has one).

const TEMPLE = "Longshan Temple";

async function skipWithoutMaps(page) {
  const map = page.getByRole("region", { name: /Trip map|Where it will show/ }).first();
  await expect(map).toHaveAttribute("data-map-state", /^(ready|unconfigured|loading)$/, { timeout: 20_000 });
  test.skip((await map.getAttribute("data-map-state")) === "unconfigured", "This environment has no Maps key.");
}

async function readPin(api, id) {
  return ok(api.get(`/api/pins/${id}`), "read pin");
}

test("an idea is linked to its Google Maps place from its own screen", async ({ page, api, seed }) => {
  const trip = await seed({ pins: [{ title: TEMPLE, region: "Taipei" }] });
  const pinId = trip.pins[TEMPLE];
  await page.goto(`/trips/${trip.id}/edit/${pinId}?from=board`);
  await skipWithoutMaps(page);

  await page.getByRole("button", { name: /Find it on Google Maps/ }).click();
  await expect(page.getByRole("searchbox", { name: "Search for a place" })).toHaveValue(TEMPLE);
  const first = page.getByRole("list", { name: "Places found" }).getByRole("listitem").first();
  await expect(first).toContainText("Longshan", { timeout: 20_000 });
  await first.getByRole("button").first().click();
  await page.getByRole("button", { name: "Link to this place" }).click();

  // Back on the idea, linked but not yet saved.
  await expect(page.getByText("At its spot on Google Maps.")).toBeVisible();
  await expect(page.getByText("The link was empty, so it’s now the Google Maps page.")).toBeVisible();
  expect((await readPin(api, pinId)).lat).toBeNull();

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}/board$`));
  const pin = await readPin(api, pinId);
  expect(pin.title).toBe(TEMPLE);
  expect(pin.lat).toEqual(expect.any(Number));
  expect(pin.google_place_id).toBeTruthy();
  expect(pin.link).toContain("google.com/maps");
});

test("an idea is linked from the Map tab's region list", async ({ page, api, seed }) => {
  const trip = await seed({ pins: [{ title: TEMPLE, region: "Taipei" }] });
  const pinId = trip.pins[TEMPLE];
  await page.goto(`/trips/${trip.id}/map`);
  await skipWithoutMaps(page);

  await expect(page.getByText("1 of 1 ideas on the map")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Taipei" }).click();
  await page.getByRole("button", { name: "Find on Google" }).click();
  const first = page.getByRole("list", { name: "Places found" }).getByRole("listitem").first();
  await expect(first).toContainText("Longshan", { timeout: 20_000 });
  await first.getByRole("button").first().click();
  await page.getByRole("button", { name: "Link to this place" }).click();

  await expect(page.getByText(/Linked to .* on Google Maps\./)).toBeVisible();
  const pin = await readPin(api, pinId);
  expect(pin.google_place_id).toBeTruthy();
  expect(pin.title).toBe(TEMPLE);
});

test("the review links the ideas it's sure about, once confirmed", async ({ page, api, seed }) => {
  const trip = await seed({
    pins: [
      { title: TEMPLE, region: "Taipei" },
      { title: "Auntie Wen's secret dumpling stall", region: "Taipei" },
    ],
  });
  await page.goto(`/trips/${trip.id}/map`);
  await skipWithoutMaps(page);

  await page.getByRole("button", { name: /ideas might be on Google Maps · Review/ }).click({ timeout: 20_000 });
  await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}/map/review$`));
  const temple = page.getByRole("region", { name: TEMPLE });
  await expect(temple.getByRole("button", { name: "Link" })).toBeEnabled({ timeout: 20_000 });
  // Nothing changes until it's confirmed.
  await temple.getByRole("button", { name: "Link" }).click();
  expect((await readPin(api, trip.pins[TEMPLE])).lat).toBeNull();

  await page.getByRole("button", { name: "Link 1" }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}/map$`));
  await expect(page.getByText("1 idea linked to Google Maps.")).toBeVisible();
  expect((await readPin(api, trip.pins[TEMPLE])).google_place_id).toBeTruthy();
  expect((await readPin(api, trip.pins["Auntie Wen's secret dumpling stall"])).lat).toBeNull();
});
