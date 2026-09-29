import { test, expect } from "../support/fixtures.js";
import { ok } from "../support/api.js";
import { dayUrl, dragHours } from "../support/calendar.js";
import { pinsOf } from "../support/seed.js";

const boardUrl = (trip) => `/trips/${trip.id}/board`;

// Names of the pin rows in the "+ Add" sheet's list, top to bottom.
async function pickerOrder(page, titles) {
  const rows = page.getByRole("button", { name: new RegExp(`^(${titles.join("|")})`) });
  return (await rows.allTextContents()).map((text) => titles.find((t) => text.startsWith(t)));
}

test("hearting an idea on the board counts it, and unhearting takes it back", async ({ page, api, seed }) => {
  const trip = await seed({ pins: [{ title: "Raohe Night Market" }] });
  await page.goto(boardUrl(trip));

  const heart = page.getByRole("button", { name: /^Heart Raohe Night Market/ });
  await expect(heart).toHaveAttribute("aria-pressed", "false");
  await heart.click();
  await expect(heart).toHaveAttribute("aria-pressed", "true");
  await expect(heart).toHaveAccessibleName("Heart Raohe Night Market (1 heart)");
  // The heart is its own tap: the card didn't open.
  await expect(page).toHaveURL(/\/board$/);
  await expect.poll(async () => (await pinsOf(api, trip))[0].hearted_by).toHaveLength(1);

  // It's on the pin's own screen too, by name.
  await page.getByText("Raohe Night Market").click();
  await expect(page.getByText("You hearted this")).toBeVisible();
  await page.getByRole("button", { name: /^Heart Raohe Night Market/ }).click();
  await expect(page.getByText("Heart this if you'd like to go")).toBeVisible();
  await expect.poll(async () => (await pinsOf(api, trip))[0].hearted_by).toEqual([]);
});

test("the add sheet sorts unplaced pins by hearts when asked, and remembers it", async ({ page, seed }) => {
  const trip = await seed({
    pins: [{ title: "Longshan Temple" }, { title: "Elephant Mountain", hearted: true }, { title: "Beitou Hot Springs" }],
  });
  const titles = ["Longshan Temple", "Elephant Mountain", "Beitou Hot Springs"];
  await page.goto(dayUrl(trip));

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: /^Add a pin/ }).click();
  await expect(page.getByRole("radio", { name: "Suggested" })).toHaveAttribute("aria-checked", "true");
  expect(await pickerOrder(page, titles)).toEqual(titles);

  await page.getByRole("radio", { name: "Most hearted" }).click();
  expect(await pickerOrder(page, titles)).toEqual(["Elephant Mountain", "Longshan Temple", "Beitou Hot Springs"]);
  await expect(page.getByText(/· ♥ 1$/)).toBeVisible();

  // Still "Most hearted" the next time the sheet opens.
  await page.reload();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: /^Add a pin/ }).click();
  await expect(page.getByRole("radio", { name: "Most hearted" })).toHaveAttribute("aria-checked", "true");
  expect(await pickerOrder(page, titles)).toEqual(["Elephant Mountain", "Longshan Temple", "Beitou Hot Springs"]);
});

test("proposing hours can pull in the most hearted ideas first", async ({ page, seed }) => {
  const trip = await seed({ pins: [{ title: "Shaved ice" }, { title: "Tide pools", hearted: true }] });
  await page.goto(`${dayUrl(trip)}/propose`);
  await dragHours(page, "09:00", "11:00");
  await page.getByRole("button", { name: "Fill these hours" }).click();

  const chips = page.getByRole("button", { name: /^(Shaved ice|Tide pools) · / });
  await page.getByRole("radio", { name: "Suggested" }).click();
  await expect(chips.first()).toHaveAccessibleName(/^Shaved ice/);

  await page.getByRole("radio", { name: "Most hearted" }).click();
  await expect(chips.first()).toHaveAccessibleName(/^Tide pools .*♥ 1$/);
});

// A pin added from a pasted link starts out named after the link's host;
// once renamed, the chip has to show the new name (it used to show a
// copy of the name taken when the pin was created).
test("pull-in chips show a pin's current name after it's renamed", async ({ page, api, seed }) => {
  const trip = await seed({ pins: [{ title: "maps.app.goo.gl" }] });
  const pinId = trip.pins["maps.app.goo.gl"];
  await ok(api.patch(`/api/pins/${pinId}`, { data: { title: "Raohe Night Market" } }), "rename pin");

  await page.goto(`${dayUrl(trip)}/propose`);
  await dragHours(page, "09:00", "11:00");
  await page.getByRole("button", { name: "Fill these hours" }).click();

  await expect(page.getByRole("button", { name: /^Raohe Night Market · / })).toBeVisible();
  await expect(page.getByRole("button", { name: /^maps\.app\.goo\.gl · / })).toHaveCount(0);
});
