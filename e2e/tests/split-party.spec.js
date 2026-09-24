import { test, expect } from "../support/fixtures.js";
import { dayUrl, openPlan } from "../support/calendar.js";
import { placePlan, plansOf } from "../support/seed.js";

test.describe("splitting the group", () => {
  test("splits a plan into two groups over the same hours", async ({ page, api, seed }) => {
    const trip = await seed({ travelers: ["Ana", "Lin", "Jae"], events: [{ title: "Scooter hire" }] });
    await placePlan(api, trip, { from: "10:00", to: "11:00", event: trip.events["Scooter hire"] });
    await page.goto(dayUrl(trip));

    await openPlan(page, "Scooter hire");
    await page.getByRole("button", { name: "Split the group" }).click();
    await page.getByRole("button", { name: "A Ana" }).click();
    await page.getByRole("button", { name: "L Lin" }).click();
    await page.getByRole("textbox", { name: "Name the new plan" }).fill("Taroko hike");
    await page.getByRole("button", { name: /^Split 10:00/ }).click();

    await expect(page.getByText("Ana and Lin: Taroko hike until 11:00")).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByText("Taroko hike")).toBeVisible();
    await expect(page.getByRole("group", { name: "Whose day to show" })).toBeVisible();

    const plans = await plansOf(api, trip);
    const members = (label) => plans.find((p) => p.label === label).party_members.sort();
    expect(members("Taroko hike")).toEqual([trip.travelers.Ana, trip.travelers.Lin].sort());
    expect(members("")).toEqual([trip.me, trip.travelers.Jae].sort());
  });

  // Regression: deleting one group's event used to delete that group's plan
  // outright, leaving its people on no plan next to the other group's --
  // and every way back into those hours landed on the other group.
  test("deleting one group's event keeps that group, empty, beside the other", async ({ page, api, seed }) => {
    const trip = await seed({ travelers: ["Ana", "Lin", "Jae"], events: [{ title: "Scooter hire" }] });
    const plan = await placePlan(api, trip, { from: "10:00", to: "11:00", event: trip.events["Scooter hire"] });
    const split = await api.post(`/api/plans/${plan.id}/split`, {
      data: { leaving: [trip.travelers.Ana, trip.travelers.Lin], label: "Taroko hike" },
    });
    expect(split.status()).toBe(201);
    await page.goto(dayUrl(trip));

    await openPlan(page, "Scooter hire");
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await page.getByRole("button", { name: "confirm?" }).click();

    await expect(page.getByText("Scooter hire")).toHaveCount(0);
    await expect(page.getByText("Nothing planned yet")).toBeVisible();
    await expect(page.getByText("Taroko hike")).toBeVisible();

    const plans = await plansOf(api, trip);
    expect(plans).toHaveLength(2);
    const stayers = plans.find((p) => p.id === plan.id);
    expect(stayers.items).toEqual([]);
    expect(stayers.party_members.sort()).toEqual([trip.me, trip.travelers.Jae].sort());
  });
});
