import { test, expect } from "../support/fixtures.js";
import { ok } from "../support/api.js";

// Editing an idea (pages/EditVisit.jsx): changes are a draft until Save,
// which sits in the fixed header so it's in reach however long the screen
// gets. It only lights up once something has changed.

const editUrl = (trip, pinId) => `/trips/${trip.id}/edit/${pinId}?from=board`;

test("Save in the header lights up after a change and saves it", async ({ page, api, seed }) => {
  const trip = await seed({ pins: [{ title: "Raohe Night Market", region: "Taipei" }] });
  const pinId = trip.pins["Raohe Night Market"];
  await page.goto(editUrl(trip, pinId));

  const save = page.getByRole("button", { name: "Save changes" });
  await expect(save).toBeDisabled();
  await page.getByLabel("Title").fill("Raohe Night Market, late");
  await expect(save).toBeEnabled();

  // Still reachable after scrolling to the bottom of the form.
  await page.getByRole("button", { name: "Delete pin" }).scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();
  await save.click();

  await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}/board$`));
  const pin = await ok(api.get(`/api/pins/${pinId}`), "read pin");
  expect(pin.title).toBe("Raohe Night Market, late");
});

test("Cancel with unsaved changes asks before throwing them away", async ({ page, api, seed }) => {
  const trip = await seed({ pins: [{ title: "Raohe Night Market", region: "Taipei" }] });
  const pinId = trip.pins["Raohe Night Market"];
  await page.goto(editUrl(trip, pinId));

  await page.getByLabel("Notes for the group").fill("Go hungry");
  await page.getByRole("button", { name: "‹ Cancel" }).click();
  await expect(page.getByText("Discard these changes?")).toBeVisible();

  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByLabel("Notes for the group")).toHaveValue("Go hungry");

  await page.getByRole("button", { name: "‹ Cancel" }).click();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}/board$`));
  const pin = await ok(api.get(`/api/pins/${pinId}`), "read pin");
  expect(pin.notes).toBe("");
});

// ---- Region and "On the map", the same as when adding by hand ----

const hasMap = async (page) => (await page.getByRole("region", { name: "Where it will show" }).count()) > 0;

test("an idea's region can be changed with the trip's region chips", async ({ page, api, seed }) => {
  const trip = await seed({
    pins: [
      { title: "Snorkel and Beach Break", region: "Playa del Carmen" },
      { title: "Chankanaab Beach Park", region: "Cozumel" },
    ],
  });
  const pinId = trip.pins["Snorkel and Beach Break"];
  await page.goto(editUrl(trip, pinId));

  await expect(page.getByRole("button", { name: "Playa del Carmen", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Cozumel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cozumel", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}/board$`));
  const pin = await ok(api.get(`/api/pins/${pinId}`), "read pin");
  expect(pin.region).toBe("Cozumel");
});

test("an exact spot can be pinned from the idea's screen", async ({ page, api, seed }) => {
  const trip = await seed({ pins: [{ title: "Snorkel and Beach Break", region: "Cozumel" }] });
  const pinId = trip.pins["Snorkel and Beach Break"];
  await page.goto(editUrl(trip, pinId));
  test.skip(!(await hasMap(page)), "This environment has no Maps key.");

  await expect(page.getByText("Shown in Cozumel").first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Pin an exact spot ›" }).click();
  const map = page.getByRole("region", { name: "Where it will show" });
  const box = await map.boundingBox();
  await map.click({ position: { x: box.width * 0.3, y: box.height * 0.3 } });
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Exact spot set.")).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}/board$`));
  const pin = await ok(api.get(`/api/pins/${pinId}`), "read pin");
  expect(pin.lat).toEqual(expect.any(Number));
  expect(pin.google_place_id).toBeNull();
});

test("removing a searched place's spot puts it back in its region", async ({ page, api, seed }) => {
  const trip = await seed({ pins: [{ title: "Tacos El Faro", region: "Cozumel", lat: 20.51, lng: -86.95, placeId: "ChIJ-e2e-faro" }] });
  const pinId = trip.pins["Tacos El Faro"];
  await page.goto(editUrl(trip, pinId));
  test.skip(!(await hasMap(page)), "This environment has no Maps key.");

  await expect(page.getByText("At its spot on Google Maps.")).toBeVisible();
  await page.getByRole("button", { name: "Remove it" }).click();
  await expect(page.getByText("Shown in Cozumel").first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}/board$`));
  const pin = await ok(api.get(`/api/pins/${pinId}`), "read pin");
  expect(pin).toMatchObject({ lat: null, lng: null, google_place_id: null });
});
