import { test, expect } from "../support/fixtures.js";
import { dayUrl, dragBlock } from "../support/calendar.js";
import { contestsOf, placePlan, proposeBlock, clockOf } from "../support/seed.js";

// Dragging a proposal on the day grid (lib/planDrag.js). A proposal with
// nothing competing for its hours moves like any calendar item, its vote
// and all (backend/app/routers/contests.py move_lone_proposal); once
// something competes, the hours are what's being voted on and stay put.
test.describe("moving a proposal", () => {
  test("drags a lone proposal to a new start time", async ({ page, api, seed }) => {
    const trip = await seed({ pins: [{ title: "Night market", minutes: 90 }] });
    await proposeBlock(api, trip, { from: "13:00", to: "15:00", pins: [trip.pins["Night market"]] });
    await page.goto(dayUrl(trip));
    await expect(page.getByText("13:00–15:00 · proposed")).toBeVisible();

    await dragBlock(page, "Night market", "13:00", "16:00");

    await expect(page.getByText("16:00–18:00 · proposed")).toBeVisible();
    await expect.poll(async () => clockOf((await contestsOf(api, trip))[0]?.start_min)).toBe("16:00");
    const [contest] = await contestsOf(api, trip);
    expect(clockOf(contest.end_min)).toBe("18:00");
    expect(contest.plans).toHaveLength(1);
  });

  test("a proposal competing with the board stays put", async ({ page, api, seed }) => {
    const trip = await seed({ pins: [{ title: "Night market", minutes: 90 }], events: [{ title: "Scooter hire" }] });
    await placePlan(api, trip, { from: "13:00", to: "14:00", event: trip.events["Scooter hire"] });
    await proposeBlock(api, trip, { from: "13:00", to: "15:00", pins: [trip.pins["Night market"]] });
    await page.goto(dayUrl(trip));

    await dragBlock(page, "Night market", "13:00", "16:00");

    const [contest] = await contestsOf(api, trip);
    expect(clockOf(contest.start_min)).toBe("13:00");
    expect(contest.plans).toHaveLength(2);
  });
});
