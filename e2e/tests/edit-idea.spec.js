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
