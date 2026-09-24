import { test, expect } from "../support/fixtures.js";
import { dayUrl } from "../support/calendar.js";

test("signed in, the test account sees its trip and can open the schedule", async ({ page, seed }) => {
  const trip = await seed();

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Trips" })).toBeVisible();
  await expect(page.getByText(trip.name)).toBeVisible();

  await page.goto(dayUrl(trip));
  await expect(page.getByText("Day 1 · Sat Oct 3")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add", exact: true })).toBeVisible();
});
