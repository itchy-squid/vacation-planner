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

  // "Paste a link" is the by-hand form, with or without place search.
  await page.getByRole("button", { name: /^Paste a link/ }).click();
  await expect(page.getByLabel("Link", { exact: true })).toBeFocused();
  await page.getByLabel("Title").fill("Longshan Temple");
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

test("a few short regions filter the board as chips", async ({ page, seed }) => {
  const trip = await seed({
    pins: [
      { title: "Raohe Night Market", region: "Taipei" },
      { title: "Sun Moon Lake", region: "Nantou" },
    ],
  });
  await page.goto(boardUrl(trip));

  const chips = page.getByRole("group", { name: "Filter by region" });
  await expect(chips.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  await chips.getByRole("button", { name: "Nantou" }).click();

  await expect(page.getByText("Sun Moon Lake")).toBeVisible();
  await expect(page.getByText("Raohe Night Market")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Region:/ })).toHaveCount(0);
});

test("regions too many or too long for one row collapse into a region sheet", async ({ page, seed }) => {
  const regions = [
    "Taipei",
    "Jiufen and the Northeast Coast",
    "Taroko National Park",
    "Sun Moon Lake",
    "Alishan Forest Recreation Area",
    "Tainan",
    "Kaohsiung",
  ];
  const trip = await seed({ pins: regions.map((region, i) => ({ title: `Idea ${i + 1}`, region })) });
  await page.goto(boardUrl(trip));

  // Nothing on the board runs past the side of the screen.
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflows).toBe(false);
  await expect(page.getByRole("group", { name: "Filter by region" })).toHaveCount(0);

  await page.getByRole("button", { name: "Region: All" }).click();
  const sheet = page.getByRole("dialog", { name: "Filter by region" });
  await expect(sheet.getByRole("radio")).toHaveCount(regions.length + 1);
  await expect(sheet.getByRole("radio", { name: /^All/ })).toHaveAttribute("aria-checked", "true");

  await sheet.getByRole("radio", { name: /^Alishan Forest Recreation Area/ }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Region: Alishan Forest Recreation Area" })).toBeVisible();
  await expect(page.getByText("Idea 5")).toBeVisible();
  await expect(page.getByText("Idea 1", { exact: true })).toHaveCount(0);

  // Back to everything from the sheet's "All".
  await page.getByRole("button", { name: /^Region:/ }).click();
  await page.getByRole("dialog", { name: "Filter by region" }).getByRole("radio", { name: /^All/ }).click();
  await expect(page.getByText("Idea 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Idea 7")).toBeVisible();
});
