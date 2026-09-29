import { test, expect } from "../support/fixtures.js";
import { BASE_URL } from "../support/env.js";

// The Map tab when zoomed out and when an idea is selected
// (pages/TripMap.jsx, components/map/IdeaMarkers.jsx):
//   - exact spots too close to tell apart merge into a bubble with a count,
//     which counts exact spots only; region-only ideas keep their badge,
//     even right beside the bubble
//   - tapping a bubble zooms in just until it breaks up; one whose ideas
//     share a spot lists them instead
//   - a selected idea shows its photo, and ✕, a tap on empty map or Esc
//     goes back to the summary
// Markers only exist on a real map, so these skip without a Maps key.

// Three spots on Cozumel, a few km apart.
const CHANKANAAB = { title: "Chankanaab Park", region: "Cozumel", lat: 20.443, lng: -86.998 };
const PALANCAR = { title: "Palancar Reef", region: "Cozumel", lat: 20.33, lng: -87.03 };
const PUNTA_SUR = { title: "Punta Sur Eco Park", region: "Cozumel", lat: 20.285, lng: -86.99 };
// Far enough away that fitting the trip zooms out until Cozumel's three merge.
const MERIDA = { title: "Paseo de Montejo", region: "Mérida", lat: 20.975, lng: -89.62 };
const TULUM = { title: "Tulum ruins", region: "Tulum", lat: 20.215, lng: -87.429 };

async function openMap(page, trip) {
  await page.goto(`/trips/${trip.id}/map`);
  const map = page.getByRole("region", { name: "Trip map" });
  await expect(map).toHaveAttribute("data-map-state", /^(ready|unconfigured)$/, { timeout: 20_000 });
  test.skip((await map.getAttribute("data-map-state")) !== "ready", "This environment has no Maps key.");
  return map;
}

test("zoomed out, nearby ideas share a bubble that zooms in when tapped", async ({ page, seed }) => {
  const trip = await seed({
    pins: [CHANKANAAB, PALANCAR, PUNTA_SUR, MERIDA, { title: "Catamaran to El Cielo", region: "Cozumel" }],
  });
  await openMap(page, trip);
  await expect(page.getByText("5 of 5 ideas on the map")).toBeVisible({ timeout: 20_000 });

  // Three, not four: the catamaran has no exact spot, so it stays in
  // Cozumel's own badge rather than joining the bubble.
  const bubble = page.getByRole("button", { name: "3 ideas here" });
  const badge = page.getByRole("button", { name: "Cozumel", exact: true });
  await expect(bubble).toBeVisible({ timeout: 20_000 });
  await expect(badge).toBeVisible();
  await expect(page.getByRole("button", { name: MERIDA.title })).toBeVisible();

  // Each tap zooms in only until the bubble breaks up, so it can take a
  // few taps (on what's left of it) before every spot is its own dot.
  await bubble.click();
  await expect(bubble).toHaveCount(0, { timeout: 20_000 });
  await expect(badge).toBeVisible();
  // A bubble that breaks up always leaves more markers than it was, so
  // count the Cozumel spots' dots plus any bubbles still standing.
  const remaining = page.getByRole("button", { name: /^\d+ ideas here$/ });
  const markers = async () => {
    let dots = 0;
    for (const pin of [CHANKANAAB, PALANCAR, PUNTA_SUR]) dots += await page.getByRole("button", { name: pin.title }).count();
    return dots + (await remaining.count());
  };
  for (let taps = 0; taps < 5 && (await remaining.count()) > 0; taps += 1) {
    const before = await markers();
    await remaining.first().click();
    await expect.poll(markers, { timeout: 20_000 }).toBeGreaterThan(before);
  }
  for (const pin of [CHANKANAAB, PALANCAR, PUNTA_SUR]) {
    await expect(page.getByRole("button", { name: pin.title })).toBeVisible();
  }
});

test("a bubble whose ideas share one spot lists them", async ({ page, seed }) => {
  const hotel = { region: "Cozumel", lat: 20.506, lng: -86.951 };
  const trip = await seed({ pins: [{ ...hotel, title: "Hotel breakfast" }, { ...hotel, title: "Hotel spa" }, TULUM] });
  await openMap(page, trip);

  await page.getByRole("button", { name: "2 ideas here" }).click({ timeout: 20_000 });
  await expect(page.getByText("2 ideas at this spot")).toBeVisible();
  const list = page.getByRole("list", { name: "Ideas at this spot" });
  await list.getByRole("button", { name: "Hotel spa" }).click();
  await expect(page.getByText("Cozumel · exact spot")).toBeVisible();
});

test("a selected idea shows its photo, and the selection can be cleared", async ({ page, seed }) => {
  const photoUrl = `${BASE_URL}/favicon-32.png`;
  const trip = await seed({ pins: [{ ...CHANKANAAB, photoUrl }, TULUM] });
  const map = await openMap(page, trip);
  const summary = page.getByText("2 of 2 ideas on the map");
  await expect(summary).toBeVisible({ timeout: 20_000 });

  const select = async () => {
    await page.getByRole("button", { name: CHANKANAAB.title }).click();
    await expect(page.getByRole("img", { name: CHANKANAAB.title })).toBeVisible();
    await expect(summary).toHaveCount(0);
  };

  // ✕ in the sheet.
  await select();
  await page.getByRole("button", { name: "Clear selection" }).click();
  await expect(summary).toBeVisible();

  // A tap on empty map. The fitted map has Chankanaab top right and Tulum
  // bottom left, so the bottom right is clear (Google's zoom buttons sit
  // in the very corner).
  await select();
  const box = await map.boundingBox();
  await map.click({ position: { x: box.width * 0.7, y: box.height * 0.75 } });
  await expect(summary).toBeVisible();

  // Esc.
  await select();
  await page.keyboard.press("Escape");
  await expect(summary).toBeVisible();

  // An idea without a photo has no photo band.
  await page.getByRole("button", { name: TULUM.title }).click();
  await expect(page.getByText("Tulum · exact spot")).toBeVisible();
  await expect(page.getByRole("img", { name: TULUM.title })).toHaveCount(0);
});
