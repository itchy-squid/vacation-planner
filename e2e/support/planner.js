import { expect } from "@playwright/test";

// The route planner every proposal is built in (pages/PlanTrip.jsx).

// Set when the proposal starts, through the "Starts" sheet's hour and
// minute buttons ("09", "30").
export async function startAt(page, hour, minute) {
  await page.getByRole("button", { name: /^Starts at/ }).click();
  await page.getByRole("group", { name: "Hour" }).getByRole("button", { name: new RegExp(`^${hour}:00`) }).click();
  await page.getByRole("group", { name: "Minute" }).getByRole("button", { name: `:${minute}` }).click();
  await page.getByRole("button", { name: /^Done/ }).click();
  await expect(page.getByRole("button", { name: `Starts at ${hour}:${minute}. Change` })).toBeVisible();
}

// Add a custom event as the next stop. It has no spot on the map, so it
// needs no ride — and no Maps key.
export async function addCustomEvent(page, title) {
  await page.getByRole("button", { name: /^\+ Add a stop|^Tap a place on the map, or/ }).click();
  await page.getByRole("button", { name: /^Custom event/ }).click();
  await page.getByPlaceholder("Lunch").fill(title);
  await page.getByRole("button", { name: /^Add (after|it)/ }).click();
  await expect(page.getByRole("list", { name: "Trip" }).getByText(title, { exact: true })).toBeVisible();
}
