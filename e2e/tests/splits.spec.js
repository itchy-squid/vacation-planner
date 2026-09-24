import { test, expect } from "../support/fixtures.js";
import { dayUrl, dragHours, openPlan, tapLane } from "../support/calendar.js";
import { contestsOf, placePlan, plansOf, splitDay, splitsOf } from "../support/seed.js";

// The group splitting up for part of a day (backend/app/splits.py): a split
// is a stretch of hours with a lane per group, and each plan in those hours
// belongs to one group.
test.describe("splitting the group", () => {
  test("splits a plan into two groups over the same hours", async ({ page, api, seed }) => {
    const trip = await seed({ travelers: ["Ana", "Lin", "Jae"], events: [{ title: "Scooter hire" }] });
    const plan = await placePlan(api, trip, { from: "10:00", to: "11:00", event: trip.events["Scooter hire"] });
    await page.goto(dayUrl(trip));

    await openPlan(page, "Scooter hire");
    await page.getByRole("button", { name: "Split the group" }).click();
    await page.getByRole("button", { name: "A Ana" }).click();
    await page.getByRole("button", { name: "L Lin" }).click();
    await page.getByRole("textbox", { name: "Name the new group" }).fill("Taroko hike");
    await page.getByRole("button", { name: /^Split 10:00/ }).click();

    await expect(page.getByText("Taroko hike: nothing planned yet")).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByText("Taroko hike", { exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: "Whose day to show" })).toBeVisible();

    const [split] = await splitsOf(api, trip);
    const [stay, leave] = split.branches;
    expect(stay.traveler_ids.sort()).toEqual([trip.me, trip.travelers.Jae].sort());
    expect(leave).toMatchObject({ label: "Taroko hike", traveler_ids: [trip.travelers.Ana, trip.travelers.Lin].sort() });
    const [kept] = await plansOf(api, trip);
    expect(kept.id).toBe(plan.id);
    expect(kept.branch_id).toBe(stay.id);
  });

  // Regression: with both groups' plans filling the split hours, every tap
  // landed on a block and was ignored, so nothing could be placed for
  // either group.
  test("places into one group's lane while both groups are busy", async ({ page, api, seed }) => {
    const trip = await seed({
      travelers: ["Ana", "Lin"],
      pins: [{ title: "Gorge trail" }, { title: "Lake loop" }, { title: "Shaved ice", minutes: 30 }],
    });
    const split = await splitDay(api, trip, {
      from: "09:00",
      to: "12:00",
      groups: [
        { label: "Gorge", travelers: [trip.travelers.Ana, trip.travelers.Lin] },
        { label: "Lake", travelers: [trip.me] },
      ],
    });
    const [gorge, lake] = split.branches;
    await placePlan(api, trip, { from: "09:00", to: "10:00", pin: trip.pins["Gorge trail"], branch: gorge.id });
    await placePlan(api, trip, { from: "09:00", to: "10:00", pin: trip.pins["Lake loop"], branch: lake.id });
    await page.goto(dayUrl(trip));

    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("button", { name: /^Add a pin/ }).click();
    await page.getByRole("button", { name: /^Shaved ice/ }).click();
    await expect(page.getByText("Placing Shaved ice — tap the calendar")).toBeVisible();
    await tapLane(page, "Lake", "11:00");

    await expect(page.getByText("Shaved ice", { exact: true })).toBeVisible();
    const placed = (await plansOf(api, trip)).find((p) => p.items[0]?.pin?.title === "Shaved ice");
    expect(placed.branch_id).toBe(lake.id);
    expect(placed.starts_at).toContain("T11:00");
  });

  // The reported bug: the hour picker clipped at, and refused, hours that
  // held the other group's plans, so no block could be proposed during a
  // split. Now a drag started in a group's lane is for that group, and only
  // that group's own pinned plans stop it.
  test("proposes a block for one group during a split", async ({ page, api, seed }) => {
    const trip = await seed({
      travelers: ["Ana", "Lin"],
      pins: [{ title: "Gorge trail", minutes: 180 }, { title: "Lake loop" }, { title: "Beach", minutes: 60 }],
    });
    const split = await splitDay(api, trip, {
      from: "09:00",
      to: "12:00",
      groups: [
        { label: "Gorge", travelers: [trip.travelers.Ana, trip.travelers.Lin] },
        { label: "Lake", travelers: [trip.me] },
      ],
    });
    const [gorge, lake] = split.branches;
    await placePlan(api, trip, { from: "09:00", to: "12:00", pin: trip.pins["Gorge trail"], branch: gorge.id });
    await placePlan(api, trip, { from: "09:00", to: "10:00", pin: trip.pins["Lake loop"], branch: lake.id });
    await page.goto(`${dayUrl(trip)}/propose`);

    // The right half of the grid is the Lake lane.
    await dragHours(page, "09:00", "11:00", 0.75);
    await expect(page.getByRole("button", { name: "Lake", pressed: true })).toBeVisible();
    await expect(page.getByText("09:00 – 11:00 · 2h")).toBeVisible();
    await page.getByRole("button", { name: "Fill these hours" }).click();

    await page.getByRole("button", { name: /^Beach/ }).first().click();
    await page.getByRole("button", { name: /^Add stop/ }).click();
    await page.getByRole("button", { name: /^Review/ }).click();
    await expect(page.getByText(/For Lake only/)).toBeVisible();
    await page.getByRole("button", { name: "Send to vote" }).click();
    await expect(page).toHaveURL(/\/contests\/\d+/);

    const [contest] = await contestsOf(api, trip);
    expect(contest.branch_id).toBe(lake.id);
    expect(contest.starts_at).toContain("T09:00");
    // The other group's plan was never touched.
    const gorgePlan = (await plansOf(api, trip)).find((p) => p.items[0]?.pin?.title === "Gorge trail");
    expect(gorgePlan).toMatchObject({ status: "placed", branch_id: gorge.id });
  });

  test("brings everyone back, keeping one group's plans", async ({ page, api, seed }) => {
    const trip = await seed({ travelers: ["Ana", "Lin"], pins: [{ title: "Gorge trail" }, { title: "Lake loop" }] });
    const split = await splitDay(api, trip, {
      from: "09:00",
      to: "12:00",
      groups: [
        { label: "Gorge", travelers: [trip.travelers.Ana, trip.travelers.Lin] },
        { label: "Lake", travelers: [trip.me] },
      ],
    });
    const [gorge, lake] = split.branches;
    const hike = await placePlan(api, trip, { from: "09:00", to: "10:00", pin: trip.pins["Gorge trail"], branch: gorge.id });
    await placePlan(api, trip, { from: "10:00", to: "11:00", pin: trip.pins["Lake loop"], branch: lake.id });
    await page.goto(dayUrl(trip));

    await openPlan(page, "Gorge trail");
    await page.getByRole("button", { name: "Bring everyone back" }).click();
    await expect(page.getByText("Lake loop comes off the calendar.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Bring everyone back" }).click();
    await page.getByRole("button", { name: "Close" }).click();

    await expect(page.getByText("Lake loop", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Whose day to show" })).toHaveCount(0);
    expect(await splitsOf(api, trip)).toEqual([]);
    const plans = await plansOf(api, trip);
    expect(plans.map((p) => [p.id, p.branch_id])).toEqual([[hike.id, null]]);
  });
});
