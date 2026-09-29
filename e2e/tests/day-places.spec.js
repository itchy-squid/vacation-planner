import { test, expect } from "../support/fixtures.js";
import { dayUrl } from "../support/calendar.js";
import { ok } from "../support/api.js";
import { dayDate, dayPlacesOf, placePlan, setDayPlaces } from "../support/seed.js";

// "Where we'll be" (backend routers/day_places.py): the place the group
// stays in each day, plus any day trips. Set from the whole-trip list
// (reached from the Plan tab's "All days ›"), one day or several at once,
// and cleared with Undo.
const placesUrl = (trip) => `/trips/${trip.id}/places`;
const dayRow = (page, day) => page.getByRole("button", { name: new RegExp(`^Day ${day},`) });

test.describe("where we'll be", () => {
  test("sets a day's stay and day trips via the Plan tab's All days", async ({ page, api, seed }) => {
    const trip = await seed({
      pins: [
        { title: "Yehliu Geopark", region: "North Coast" },
        { title: "Jiufen Old Street", region: "Jiufen" },
        { title: "Longshan Temple", region: "Taipei" },
      ],
    });
    await placePlan(api, trip, { day: 2, from: "09:00", to: "11:00", pin: trip.pins["Yehliu Geopark"] });
    await placePlan(api, trip, { day: 2, from: "15:00", to: "17:00", pin: trip.pins["Jiufen Old Street"] });
    await page.goto(dayUrl(trip, 2));

    // Places are edited from "Where we'll be", not the day header.
    await expect(page.getByRole("button", { name: /^(Set|Edit) places$/ })).toHaveCount(0);
    await page.getByRole("button", { name: "All days ›" }).click();
    await dayRow(page, 2).click();
    const sheet = page.getByRole("dialog", { name: "Day 2 places" });
    await sheet.getByRole("group", { name: /Staying in/ }).getByRole("button", { name: "Taipei", exact: true }).click();
    await sheet.getByRole("group", { name: /Day trips/ }).getByRole("button", { name: "North Coast", exact: true }).click();
    // A day trip can't be to where you're staying.
    await expect(sheet.getByRole("group", { name: /Day trips/ }).getByRole("button", { name: "Taipei", exact: true })).toBeDisabled();
    await sheet.getByRole("button", { name: "Done" }).click();
    // "‹ Plan" goes back to the day it came from.
    await page.getByRole("button", { name: "‹ Plan" }).click();

    await expect(page.getByText("Staying in Taipei · Day trip to North Coast")).toBeVisible();
    // Jiufen is on the calendar but not one of the day's places.
    await expect(page.getByRole("note").filter({ hasText: "Jiufen Old Street is in Jiufen" })).toBeVisible();
    await page.getByRole("button", { name: "Add Jiufen as a day trip" }).click();
    await expect(page.getByText("Staying in Taipei · Day trip to North Coast and Jiufen")).toBeVisible();
    await expect(page.getByRole("note")).toHaveCount(0);

    // "+ Add" shows the day's places first.
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("button", { name: /^Add a pin/ }).click();
    await expect(page.getByRole("button", { name: "Taipei", pressed: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Longshan Temple/ })).toBeVisible();

    expect(await dayPlacesOf(api, trip)).toEqual([{ date: dayDate(2), stay: "Taipei", visits: ["North Coast", "Jiufen"] }]);
  });

  test("sets several days at once and undoes clearing them", async ({ page, api, seed }) => {
    const trip = await seed({ pins: [{ title: "Pier-2 Art Center", region: "Kaohsiung" }] });
    await page.goto(placesUrl(trip));
    await expect(page.getByText("0 of 4 days set")).toBeVisible();

    await page.getByRole("button", { name: "Select" }).click();
    await dayRow(page, 1).click();
    await dayRow(page, 2).click();
    await page.getByRole("button", { name: "Staying in…" }).click();
    await page.getByRole("dialog", { name: "Staying in…" }).getByRole("button", { name: "Kaohsiung", exact: true }).click();
    await expect(page.getByText("Days 1–2: staying in Kaohsiung.")).toBeVisible();
    await expect(dayRow(page, 2)).toHaveAccessibleName(/Staying in Kaohsiung/);

    // A new place no idea uses yet, on a day of its own: a moving day.
    await dayRow(page, 3).click();
    const sheet = page.getByRole("dialog", { name: "Day 3 places" });
    await sheet.getByRole("group", { name: /Staying in/ }).getByRole("button", { name: "+ New place" }).click();
    await sheet.getByRole("textbox", { name: "New place" }).fill("Kenting");
    await sheet.getByRole("button", { name: "Add", exact: true }).click();
    await expect(sheet.getByText("Day 2 was in Kaohsiung, so this is a moving day.")).toBeVisible();
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(dayRow(page, 3)).toHaveAccessibleName(/Moving to Kenting from Kaohsiung/);
    await expect(page.getByText("3 of 4 days set")).toBeVisible();

    await page.getByRole("button", { name: "Select" }).click();
    await dayRow(page, 2).click();
    await dayRow(page, 3).click();
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(page.getByText("Cleared Days 2–3.")).toBeVisible();
    await expect.poll(async () => (await dayPlacesOf(api, trip)).length).toBe(1);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(dayRow(page, 3)).toHaveAccessibleName(/Moving to Kenting from Kaohsiung/);
    await expect
      .poll(() => dayPlacesOf(api, trip))
      .toEqual([
        { date: dayDate(1), stay: "Kaohsiung", visits: [] },
        { date: dayDate(2), stay: "Kaohsiung", visits: [] },
        { date: dayDate(3), stay: "Kenting", visits: [] },
      ]);
  });

  test("edits and clears one day, and clears every day after asking", async ({ page, api, seed }) => {
    const trip = await seed();
    await setDayPlaces(api, trip, {
      [dayDate(1)]: { stay: "Taipei" },
      [dayDate(2)]: { stay: "Taipei", visits: ["North Coast", "Jiufen"] },
      [dayDate(3)]: { stay: "Hualien" },
    });
    await page.goto(placesUrl(trip));

    // Tapping a chosen place again takes it off.
    await dayRow(page, 2).click();
    const sheet = page.getByRole("dialog", { name: "Day 2 places" });
    await sheet.getByRole("group", { name: /Day trips/ }).getByRole("button", { name: "North Coast", exact: true }).click();
    await expect(sheet.getByRole("group", { name: /Day trips/ }).getByRole("button", { name: "North Coast", exact: true })).toHaveAttribute("aria-pressed", "false");
    await sheet.getByRole("button", { name: "Day 3 ›" }).click();
    await page.getByRole("dialog", { name: "Day 3 places" }).getByRole("button", { name: "Clear this day" }).click();
    await expect(page.getByText("Cleared Day 3.")).toBeVisible();
    await page.getByRole("dialog", { name: "Day 3 places" }).getByRole("button", { name: "Done" }).click();
    await expect(dayRow(page, 3)).toHaveAccessibleName(/Not set/);
    await expect
      .poll(() => dayPlacesOf(api, trip))
      .toEqual([
        { date: dayDate(1), stay: "Taipei", visits: [] },
        { date: dayDate(2), stay: "Taipei", visits: ["Jiufen"] },
      ]);

    await page.getByRole("button", { name: "Clear every day…" }).click();
    await page.getByRole("button", { name: "Keep them" }).click();
    await expect.poll(async () => (await dayPlacesOf(api, trip)).length).toBe(2);
    await page.getByRole("button", { name: "Clear every day…" }).click();
    await page.getByRole("button", { name: "Clear all days" }).click();
    await expect(page.getByText("Cleared all 4 days.")).toBeVisible();
    await expect(page.getByText("0 of 4 days set")).toBeVisible();
    await expect.poll(() => dayPlacesOf(api, trip)).toEqual([]);
  });

  test("drops a place once no idea and no day uses it", async ({ page, api, seed }) => {
    const trip = await seed({
      pins: [
        { title: "Taroko Gorge", region: "Hualien" },
        { title: "Chihkan Tower", region: "Tainan" },
      ],
    });
    // Where Hualien is on the map, stored for the trip. It outlives the
    // idea that made it, but mustn't keep the place alive.
    await ok(
      api.put(`/api/trips/${trip.id}/regions`, {
        data: { name: "Hualien", lat: 23.99, lng: 121.6, south: 23.9, west: 121.5, north: 24.1, east: 121.7 },
      }),
      "store Hualien's location"
    );
    await setDayPlaces(api, trip, { [dayDate(1)]: { stay: "Kenting" } });

    const choices = async () => {
      await page.goto(placesUrl(trip));
      await dayRow(page, 2).click();
      return page.getByRole("dialog", { name: "Day 2 places" }).getByRole("group", { name: /Staying in/ });
    };
    let stayIn = await choices();
    for (const place of ["Hualien", "Tainan", "Kenting"]) {
      await expect(stayIn.getByRole("button", { name: place, exact: true })).toBeVisible();
    }

    await ok(api.delete(`/api/pins/${trip.pins["Taroko Gorge"]}`), "delete Taroko Gorge");
    await setDayPlaces(api, trip, { [dayDate(1)]: {} });

    stayIn = await choices();
    await expect(stayIn.getByRole("button", { name: "Tainan", exact: true })).toBeVisible();
    await expect(stayIn.getByRole("button", { name: "Hualien", exact: true })).toHaveCount(0);
    await expect(stayIn.getByRole("button", { name: "Kenting", exact: true })).toHaveCount(0);
  });

  test("offers the calendar's place for a day that isn't set", async ({ page, api, seed }) => {
    const trip = await seed({ pins: [{ title: "Pier-2 Art Center", region: "Kaohsiung" }] });
    await placePlan(api, trip, { day: 4, from: "10:00", to: "12:00", pin: trip.pins["Pier-2 Art Center"] });
    await page.goto(placesUrl(trip));

    await expect(dayRow(page, 4)).toHaveAccessibleName(/Not set/);
    await expect(page.getByText("Plans are in Kaohsiung")).toBeVisible();
    await page.getByRole("button", { name: "Use Kaohsiung for Day 4" }).click();
    await expect(dayRow(page, 4)).toHaveAccessibleName(/Staying in Kaohsiung/);

    await page.goto(dayUrl(trip, 4));
    await expect(page.getByText("Staying in Kaohsiung")).toBeVisible();
    expect(await dayPlacesOf(api, trip)).toEqual([{ date: dayDate(4), stay: "Kaohsiung", visits: [] }]);
  });
});
