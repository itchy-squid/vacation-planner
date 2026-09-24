import { expect } from "@playwright/test";

// The day grid has no per-slot elements to click: a tap anywhere on the
// ruled surface is turned into a minute from its y position
// (pages/DaySchedule.jsx handleTapAt, snapped to 15 minutes). So find the
// hour's label on the rail and tap just below its line, beside it.
export async function tapCalendar(page, clock) {
  const label = page.getByText(clock, { exact: true }).first();
  await label.scrollIntoViewIfNeeded();
  const box = await label.boundingBox();
  if (!box) throw new Error(`No ${clock} on the calendar`);
  // The label is centred on its hour line; +4px stays inside that
  // hour's first 15-minute snap.
  await page.mouse.click(box.x + box.width + 80, box.y + box.height / 2 + 4);
}

// Tap inside one group's lane on a split day, at an hour. A lane is named
// at its foot (pages/DaySchedule.jsx), so find that name for the lane's x
// and the hour's label for the y.
export async function tapLane(page, groupName, clock) {
  const lane = page.getByText(groupName, { exact: true }).first();
  await lane.scrollIntoViewIfNeeded();
  const laneBox = await lane.boundingBox();
  const label = page.getByText(clock, { exact: true }).first();
  const labelBox = await label.boundingBox();
  if (!laneBox || !labelBox) throw new Error(`No ${groupName} lane or ${clock} on the calendar`);
  await page.mouse.click(laneBox.x + 4, labelBox.y + labelBox.height / 2 + 4);
}

// Drag over the proposal hour picker from one hour to another, starting in
// whichever lane `x` (0..1 across the grid) falls in.
export async function dragHours(page, from, to, x = 0.25) {
  const start = page.getByText(from, { exact: true }).first();
  await start.scrollIntoViewIfNeeded();
  const a = await start.boundingBox();
  const b = await page.getByText(to, { exact: true }).first().boundingBox();
  const grid = page.getByTestId("day-grid-surface");
  const g = await grid.boundingBox();
  const px = g.x + g.width * x;
  await page.mouse.move(px, a.y + a.height / 2 + 2);
  await page.mouse.down();
  await page.mouse.move(px, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(px, b.y + b.height / 2 + 2, { steps: 4 });
  await page.mouse.up();
}

// Open a plan's details sheet by tapping its block. A block that has only
// just been placed can be re-rendered by the refetch that follows, eating
// the first tap, so keep tapping until the sheet is up.
export async function openPlan(page, title) {
  await expect(async () => {
    await page.getByText(title, { exact: true }).first().click({ timeout: 2000 });
    await expect(page.getByRole("button", { name: "Close" })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
}

export function dayUrl(trip, day = 1) {
  return `/trips/${trip.id}/schedule/${day}`;
}
