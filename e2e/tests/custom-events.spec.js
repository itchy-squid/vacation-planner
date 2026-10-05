import { test, expect } from "../support/fixtures.js";
import { dayUrl, openPlan, tapCalendar } from "../support/calendar.js";
import { placePlan, plansOf, travelItemsOf, clockOf } from "../support/seed.js";

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
    expect(clockOf(plans[0].start_min)).toBe("10:00");
    expect(plans[0].items[0].travel_item.title).toBe("Scooter hire");
  });

  // The people sharing a cost are whoever the plan is for, never a list
  // kept on the event: one used to charge only the traveler picked on the
  // form while the calendar said everyone was going.
  test("a priced event is charged to everyone on the plan it's placed in", async ({ page, api, seed }) => {
    const trip = await seed({ travelers: ["Ana"] });
    await page.goto(dayUrl(trip));

    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("button", { name: /^Custom event/ }).click();
    await expect(page.getByText("Who it\u2019s for")).toHaveCount(0);
    await page.getByRole("textbox", { name: "Title" }).fill("Ferry tickets");
    await page.getByRole("spinbutton", { name: "Cost per person, in dollars" }).fill("12");
    await page.getByRole("button", { name: "Add to day 1 and place" }).click();

    await expect(page.getByText("Placing Ferry tickets — tap the calendar")).toBeVisible();
    await tapCalendar(page, "14:00");

    await expect(page.getByText("Ferry tickets")).toBeVisible();
    const [plan] = await plansOf(api, trip);
    const [item] = plan.items;
    expect(item.sharer_ids).toEqual([trip.me, trip.travelers.Ana].sort((a, b) => a - b));
    expect(item.each_cents).toBe(1200);
    expect(item.total_cents).toBe(2400);
  });

  // Regression: clearing the start time used to delete the event outright,
  // so it vanished instead of landing in Unplaced like a pin does.
  test("clearing a placed event's start time sends it back to unplaced", async ({ page, api, seed }) => {
    const trip = await seed({ events: [{ title: "Scooter hire", minutes: 60 }] });
    await placePlan(api, trip, { from: "10:00", to: "11:00", event: trip.events["Scooter hire"] });
    await page.goto(dayUrl(trip));
    await expect(page.getByRole("button", { name: "0 unplaced" })).toBeVisible();

    await openPlan(page, "Scooter hire");
    await page.getByRole("button", { name: "Clear start time — removes this item from the schedule" }).click();

    await expect(page.getByRole("button", { name: "1 unplaced" })).toBeVisible();
    expect(await plansOf(api, trip)).toEqual([]);
    expect((await travelItemsOf(api, trip)).map((t) => t.title)).toEqual(["Scooter hire"]);
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
