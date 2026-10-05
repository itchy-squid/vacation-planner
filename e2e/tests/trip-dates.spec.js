import { test, expect } from "../support/fixtures.js";
import { ok } from "../support/api.js";
import { RUN_ID, TRIP_PREFIX } from "../support/env.js";
import { at, placePlan, plansOf } from "../support/seed.js";

// Planning before the dates are known, and moving them afterwards
// (frontend lib/tripWhen.js, backend app/tripdays.py):
//   - a new trip can be "Not sure yet": a length and a rough month
//   - moving a trip's start date with something on its calendar asks
//     whether the plan moves with it or stays on its dates, and can be
//     undone

async function tripsNamed(api, name) {
  const trips = await ok(api.get("/api/trips"), "list trips");
  return trips.filter((t) => t.name === name);
}

test("a new trip can be planned by length before its dates are known", async ({ page, api }) => {
  const name = `${TRIP_PREFIX}by length · ${RUN_ID}`;
  await page.goto("/new-trip");
  await page.getByLabel("Trip name").fill(name);
  await page.getByRole("button", { name: "Not sure yet" }).click();
  await page.getByRole("group", { name: "Trip length" }).getByRole("button", { name: "A week" }).click();
  await page.getByRole("group", { name: "Roughly which month" }).getByRole("button", { name: "Mar" }).click();
  await expect(page.getByText("Day 1 – Day 7 · sometime in March")).toBeVisible();

  await page.getByRole("button", { name: /^(Create trip|Next: who’s coming)$/ }).click();
  const skip = page.getByRole("button", { name: /^Skip/ });
  if (await skip.isVisible().catch(() => false)) await skip.click();

  await expect.poll(async () => (await tripsNamed(api, name)).length).toBe(1);
  const [trip] = await tripsNamed(api, name);
  expect(trip).toMatchObject({ start_date: null, end_date: null, length_days: 7, rough_month: 3, day_count: 7 });
});

test.describe("moving a trip's dates", () => {
  async function moveStartTo(page, trip, start, end) {
    await page.goto(`/trips/${trip.id}/trip-settings`);
    await page.getByLabel("Start date").fill(start);
    await page.getByLabel("End date").fill(end);
    await page.getByRole("button", { name: "Save changes" }).click();
    return page.getByRole("dialog", { name: "Move the plan with the dates?" });
  }

  test("shifting keeps the plan on its day of the trip", async ({ page, api, seed }) => {
    const trip = await seed({ pins: [{ title: "Night market", minutes: 90 }] });
    await placePlan(api, trip, { day: 2, from: "19:00", to: "20:30", pin: trip.pins["Night market"] });

    const sheet = await moveStartTo(page, trip, "2026-10-10", "2026-10-13");
    await expect(sheet.getByRole("radio", { name: /Shift everything a week later/ })).toBeChecked();
    await sheet.getByRole("button", { name: "Save dates" }).click();
    await expect(page.getByText("Dates saved · the plan moved with them")).toBeVisible();

    expect((await plansOf(api, trip))[0].start_min).toBe(at(2, "19:00"));
  });

  test("keeping dates sets aside what falls outside, and Undo brings it back", async ({ page, api, seed }) => {
    const trip = await seed({ pins: [{ title: "Night market", minutes: 90 }] });
    await placePlan(api, trip, { day: 2, from: "19:00", to: "20:30", pin: trip.pins["Night market"] });

    const sheet = await moveStartTo(page, trip, "2026-10-10", "2026-10-13");
    await sheet.getByText("Keep things on their dates").click();
    await expect(sheet.getByText(/^Set aside/)).toBeVisible();
    await sheet.getByRole("button", { name: "Save dates" }).click();
    await expect(page.getByText("Dates saved · 1 plan set aside")).toBeVisible();
    // Oct 4 is now a week before day 1.
    expect((await plansOf(api, trip))[0].start_min).toBe(at(2 - 7, "19:00"));

    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await plansOf(api, trip))[0].start_min).toBe(at(2, "19:00"));
    const [after] = await tripsNamed(api, trip.name);
    expect(after.start_date).toBe("2026-10-03");
  });
});
