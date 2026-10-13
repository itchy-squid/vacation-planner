import { test, expect } from "../support/fixtures.js";
import { dayUrl } from "../support/calendar.js";
import { ok } from "../support/api.js";
import { placePlan } from "../support/seed.js";

// Comments on a whole day (backend routers/comments.py): a chip on the Plan
// tab's places line opens them, the day strip marks days that have any, and
// the Itinerary shows them under each day.
const dayComments = async (api, trip) => ok(await api.get(`/api/trips/${trip.id}/day-comments`));

test.describe("comments on a day", () => {
  test("posts, edits and deletes a comment from the Plan tab", async ({ page, api, seed }) => {
    const trip = await seed();
    await page.goto(dayUrl(trip, 2));

    await page.getByRole("button", { name: "Comment on day 2" }).click();
    const sheet = page.getByRole("dialog", { name: /^Comments on Day 2/ });
    await expect(sheet.getByText("No comments on this day yet.", { exact: false })).toBeVisible();
    await sheet.getByRole("textbox", { name: /^Comment on Day 2/ }).fill("Ferry's at 7:40. Bring cash for the boat.");
    await sheet.getByRole("button", { name: "Post" }).click();
    await expect(sheet.getByText("Ferry's at 7:40. Bring cash for the boat.")).toBeVisible();

    await sheet.getByRole("button", { name: "Edit" }).click();
    await sheet.getByRole("textbox", { name: "Edit your comment" }).fill("Ferry's at 8:10.");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet.getByText("Ferry's at 8:10.")).toBeVisible();
    await expect(sheet.getByText(/· edited/)).toBeVisible();
    await page.keyboard.press("Escape");

    // The chip now counts it, and the day strip marks the day.
    await expect(page.getByRole("button", { name: "1 comment on day 2" })).toBeVisible();
    const [saved] = await dayComments(api, trip);
    expect(saved).toMatchObject({ day: 2, body: "Ferry's at 8:10." });

    await page.getByRole("button", { name: "1 comment on day 2" }).click();
    await sheet.getByRole("button", { name: "Delete" }).click();
    await sheet.getByRole("button", { name: "Tap again to delete" }).click();
    await expect(sheet.getByText("Ferry's at 8:10.")).toHaveCount(0);
    expect(await dayComments(api, trip)).toEqual([]);
  });

  test("shows a day's comments on the Itinerary", async ({ page, api, seed }) => {
    const trip = await seed();
    ok(await api.post(`/api/trips/${trip.id}/comments`, { data: { day: 3, body: "Check out by 11." } }));
    await page.goto(`/trips/${trip.id}/itinerary`);

    await expect(page.getByRole("button", { name: /Check out by 11\./ })).toBeVisible();
    await page.getByRole("button", { name: /Check out by 11\./ }).click();
    const sheet = page.getByRole("dialog", { name: /^Comments on Day 3/ });
    await sheet.getByRole("textbox", { name: /^Comment on Day 3/ }).fill("Bags at the front desk.");
    await sheet.getByRole("button", { name: "Post" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /Bags at the front desk\./ })).toBeVisible();
  });
});

test("calendar events made from ideas carry the pin, custom events don't", async ({ page, api, seed }) => {
  const trip = await seed({
    pins: [
      { title: "Longshan Temple", region: "Taipei", minutes: 60, lat: 25.0372, lng: 121.4999 },
      { title: "A good night market", region: "Taipei", minutes: 60 },
    ],
    events: [{ title: "Scooter hire", minutes: 60 }],
  });
  await placePlan(api, trip, { from: "10:00", to: "11:00", pin: trip.pins["Longshan Temple"] });
  await placePlan(api, trip, { from: "18:00", to: "19:00", pin: trip.pins["A good night market"] });
  await placePlan(api, trip, { from: "13:00", to: "14:00", event: trip.events["Scooter hire"] });

  await page.goto(dayUrl(trip));
  await expect(page.getByText("Scooter hire")).toBeVisible();
  await expect(page.getByRole("img", { name: "Idea" })).toHaveCount(2);
});
