import { test, expect } from "../support/fixtures.js";

const boardUrl = (trip) => `/trips/${trip.id}/board`;

test("an empty trip's Ideas board explains itself and offers ways to start", async ({ page, seed }) => {
  const trip = await seed();
  await page.goto(boardUrl(trip));

  await expect(page.getByRole("heading", { name: "What might you do on this trip?" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Paste a link/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Type a place/ })).toBeVisible();
  // The test account owns the trip, so it can invite.
  await page.getByRole("button", { name: /^Invite people/ }).click();
  await expect(page.getByRole("dialog", { name: `Invite to ${trip.name}` })).toBeVisible();
});

test("adding the first idea from the empty board replaces it with the idea", async ({ page, seed }) => {
  const trip = await seed();
  await page.goto(boardUrl(trip));

  await page.getByRole("button", { name: /^Type a place/ }).click();
  const title = page.getByLabel("Title");
  await expect(title).toBeFocused();
  await title.fill("Longshan Temple");
  await page.getByRole("button", { name: "Add to board" }).click();
  await expect(page).toHaveURL(/\/edit\/\d+/);

  await page.goto(boardUrl(trip));
  await expect(page.getByText("Longshan Temple")).toBeVisible();
  await expect(page.getByRole("heading", { name: "What might you do on this trip?" })).toHaveCount(0);
});

test("a trip with ideas shows the board, not the introduction", async ({ page, seed }) => {
  const trip = await seed({ pins: [{ title: "Raohe Night Market", region: "Taipei" }] });
  await page.goto(boardUrl(trip));

  await expect(page.getByText("Raohe Night Market")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Type a place/ })).toHaveCount(0);
});
