import { test, expect } from "../support/fixtures.js";
import { dayUrl, openPlan, tapCalendar } from "../support/calendar.js";
import { plansOf, travelItemsOf } from "../support/seed.js";

test.describe("custom events", () => {
  // Regression: arming placement right after creating the event used to
  // look the new item up before the store had it, and silently do nothing.
  test("can be placed straight after adding them", async ({ page, api, seed }) => {
    const trip = await seed();
    await page.goto(dayUrl(trip));

    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("button", { name: /^Custom event/ }).click();
    await page.getByRole("textbox", { name: "Title" }).fill("Scooter hire");
    await page.getByRole("button", { name: "Add to day 1 and place" }).click();

    await expect(page.getByText("Placing Scooter hire — tap the calendar")).toBeVisible();
    await tapCalendar(page, "10:00");

    await expect(page.getByText("Scooter hire")).toBeVisible();
    await expect(page.getByText("10:00–11:00")).toBeVisible();
    const plans = await plansOf(api, trip);
    expect(plans).toHaveLength(1);
    expect(plans[0].starts_at).toContain("T10:00");
    expect(plans[0].items[0].travel_item.title).toBe("Scooter hire");
  });

  test("with a cost split picked, can still be placed straight away", async ({ page, api, seed }) => {
    const trip = await seed({ travelers: ["Ana"] });
    await page.goto(dayUrl(trip));

    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("button", { name: /^Custom event/ }).click();
    await page.getByRole("textbox", { name: "Title" }).fill("Ferry tickets");
    await page.getByRole("button", { name: "A", exact: true }).click();
    await page.getByRole("button", { name: "Add to day 1 and place" }).click();

    await expect(page.getByText("Placing Ferry tickets — tap the calendar")).toBeVisible();
    await tapCalendar(page, "14:00");

    await expect(page.getByText("Ferry tickets")).toBeVisible();
    const [item] = await travelItemsOf(api, trip);
    expect(item.heads).toEqual([trip.travelers.Ana]);
  });

  test("deleting a placed event removes it from the calendar and the trip", async ({ page, api, seed }) => {
    const trip = await seed();
    await page.goto(dayUrl(trip));
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("button", { name: /^Custom event/ }).click();
    await page.getByRole("textbox", { name: "Title" }).fill("Night market");
    await page.getByRole("button", { name: "Add to day 1 and place" }).click();
    await expect(page.getByText("Placing Night market — tap the calendar")).toBeVisible();
    await tapCalendar(page, "19:00");

    await openPlan(page, "Night market");
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await page.getByRole("button", { name: "confirm?" }).click();

    await expect(page.getByText("Night market")).toHaveCount(0);
    expect(await plansOf(api, trip)).toEqual([]);
    expect(await travelItemsOf(api, trip)).toEqual([]);
  });
});
