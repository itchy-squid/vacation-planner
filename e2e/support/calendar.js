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
