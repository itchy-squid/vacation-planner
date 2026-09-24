import { test, expect } from "../support/fixtures.js";
import { dayUrl, tapCalendar } from "../support/calendar.js";
import { plansOf } from "../support/seed.js";

test("an unplaced pin can be picked from the add sheet and placed", async ({ page, api, seed }) => {
  const trip = await seed({ pins: [{ title: "Longshan Temple", region: "Taipei", minutes: 90 }] });
  await page.goto(dayUrl(trip));

  await expect(page.getByRole("button", { name: "1 unplaced" })).toBeVisible();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: /^Add a pin/ }).click();
  await page.getByRole("button", { name: /^Longshan Temple/ }).click();

  await expect(page.getByText(/^Placing Longshan/)).toBeVisible();
  await tapCalendar(page, "09:00");

  await expect(page.getByText("09:00–10:30")).toBeVisible();
  await expect(page.getByRole("button", { name: "0 unplaced" })).toBeVisible();
  const [plan] = await plansOf(api, trip);
  expect(plan.items[0].pin.title).toBe("Longshan Temple");
});
