import { test, expect } from "../support/fixtures.js";
import { dayUrl, openPlan, tapCalendar } from "../support/calendar.js";
import { pinsOf, placePlan, plansOf } from "../support/seed.js";

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

// A pin belongs to the ideas board: the calendar can take it off the
// schedule, but only custom events can be deleted permanently from there.
test.describe("removing a pin from the calendar", () => {
  test("sends it back to unplaced and keeps the pin", async ({ page, api, seed }) => {
    const trip = await seed({ pins: [{ title: "Longshan Temple", region: "Taipei", minutes: 60 }] });
    await placePlan(api, trip, { from: "10:00", to: "11:00", pin: trip.pins["Longshan Temple"] });
    await page.goto(dayUrl(trip));
    await expect(page.getByRole("button", { name: "0 unplaced" })).toBeVisible();

    await openPlan(page, "Longshan Temple");
    await expect(page.getByRole("button", { name: "Delete permanently" })).toHaveCount(0);
    await page.getByRole("button", { name: "Remove from schedule" }).click();

    await expect(page.getByRole("button", { name: "1 unplaced" })).toBeVisible();
    expect(await plansOf(api, trip)).toEqual([]);
    expect((await pinsOf(api, trip)).map((p) => p.title)).toEqual(["Longshan Temple"]);
  });

  test("the unplaced list offers no delete for pins", async ({ page, seed }) => {
    const trip = await seed({
      pins: [{ title: "Longshan Temple", region: "Taipei", minutes: 60 }],
      events: [{ title: "Scooter hire", minutes: 60 }],
    });
    await page.goto(dayUrl(trip));

    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("button", { name: /^Add a pin/ }).click();

    await expect(page.getByRole("button", { name: /^Longshan Temple/ })).toBeVisible();
    // Only the custom event's row carries a delete button.
    await expect(page.getByRole("button", { name: "Delete permanently" })).toHaveCount(1);
  });
});
