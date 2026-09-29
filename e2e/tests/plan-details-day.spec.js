import { test, expect } from "../support/fixtures.js";
import { dayUrl, openPlan } from "../support/calendar.js";
import { dayDate, placePlan, plansOf } from "../support/seed.js";

// The calendar item sheet's Day field (components/forms/DayStepper.jsx):
// a stepper whose day number you can also type, in place of the row of
// day chips that ran off-screen on a long trip. Seeded trips are 4 days.
test.describe("moving a calendar item to another day", () => {
  async function openScooter(page, api, seed) {
    const trip = await seed({ events: [{ title: "Scooter hire", minutes: 60 }] });
    await placePlan(api, trip, { from: "10:00", to: "11:00", event: trip.events["Scooter hire"] });
    await page.goto(dayUrl(trip));
    await openPlan(page, "Scooter hire");
    return trip;
  }

  test("typing a day number moves it there, keeping its time", async ({ page, api, seed }) => {
    const trip = await openScooter(page, api, seed);

    const day = page.getByRole("textbox", { name: "Day number" });
    await expect(day).toHaveValue("1");
    await day.fill("3");
    await day.press("Enter");

    await expect.poll(async () => (await plansOf(api, trip))[0].starts_at).toContain(`${dayDate(3)}T10:00`);
    await expect(day).toHaveValue("3");
  });

  test("the + and − buttons step a day at a time and stop at the ends", async ({ page, api, seed }) => {
    const trip = await openScooter(page, api, seed);

    await expect(page.getByRole("button", { name: "Earlier day" })).toBeDisabled();
    await page.getByRole("button", { name: "Later day" }).click();

    await expect.poll(async () => (await plansOf(api, trip))[0].starts_at).toContain(`${dayDate(2)}T10:00`);
    await expect(page.getByRole("textbox", { name: "Day number" })).toHaveValue("2");
    await expect(page.getByRole("button", { name: "Earlier day" })).toBeEnabled();
  });

  test("a day outside the trip isn't saved", async ({ page, api, seed }) => {
    const trip = await openScooter(page, api, seed);

    const day = page.getByRole("textbox", { name: "Day number" });
    await day.fill("9");
    await day.press("Enter");

    await expect(page.getByText("Pick a day from 1 to 4.")).toBeVisible();
    await expect(day).toHaveValue("1");
    expect((await plansOf(api, trip))[0].starts_at).toContain(`${dayDate(1)}T10:00`);
  });
});
