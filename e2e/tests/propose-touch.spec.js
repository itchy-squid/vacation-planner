import { test, expect } from "../support/fixtures.js";
import { dayUrl, touchDrag } from "../support/calendar.js";

// Claiming hours on a phone (components/planner/WindowSelection.jsx). The
// grid is taller than the screen, so a swipe has to scroll it rather than
// claim hours; a tap claims an hour, and a handle held at the edge of the
// pane scrolls it so a claim can reach hours that start off-screen.
test.describe("proposing a block by touch", () => {
  async function openHourPicker(page, seed) {
    const trip = await seed();
    await page.goto(`${dayUrl(trip)}/propose`);
    const pane = page.getByTestId("day-grid-surface").locator("xpath=ancestor::div[contains(@class,'screen-scroll')]");
    await expect(pane).toBeVisible();
    return { pane, grid: await page.getByTestId("day-grid-surface").boundingBox(), paneBox: await pane.boundingBox() };
  }

  test("a swipe scrolls the grid without claiming anything", async ({ page, seed }) => {
    const { pane, paneBox } = await openHourPicker(page, seed);
    const before = await pane.evaluate((el) => el.scrollTop);

    const x = paneBox.x + paneBox.width * 0.6;
    await touchDrag(page, { x, y: paneBox.y + paneBox.height * 0.8 }, { x, y: paneBox.y + paneBox.height * 0.2 });

    await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
    await expect(page.getByText("Nothing claimed yet")).toBeVisible();
  });

  test("a tap claims an hour, and a held handle scrolls to reach later hours", async ({ page, seed }) => {
    const { pane, paneBox } = await openHourPicker(page, seed);

    const nine = await page.getByText("09:00", { exact: true }).first().boundingBox();
    await page.touchscreen.tap(paneBox.x + paneBox.width * 0.6, nine.y + nine.height / 2 + 4);
    await expect(page.getByText("09:00 – 10:00 · 1h")).toBeVisible();

    const handle = await page.getByRole("slider", { name: "Move the end of the claimed hours" }).boundingBox();
    const scrolledFrom = await pane.evaluate((el) => el.scrollTop);
    await touchDrag(
      page,
      { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
      { x: handle.x + handle.width / 2, y: paneBox.y + paneBox.height - 4 },
      { holdMs: 1500 }
    );

    expect(await pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(scrolledFrom);
    // Every hour the pane scrolled past is claimed, so the end is well past
    // anything that was on screen when the finger went down.
    await expect(page.getByText(/^09:00 – (1[6-9]|2\d|00):\d\d · /)).toBeVisible();
  });
});
