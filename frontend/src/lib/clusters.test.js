// Run with `npm test` (Node's built-in test runner, no dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import { canSplit, clusterPoints, coversAny, extentOf, screenDistance, WORLD_SIZE } from "./clusters.js";

// World coordinates for a lat/lng, the same Web Mercator Google uses.
function world(lat, lng) {
  const sin = Math.sin((lat * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * WORLD_SIZE, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * WORLD_SIZE };
}

const cozumel = [
  { id: "chankanaab", ...world(20.443, -86.998) },
  { id: "palancar", ...world(20.33, -87.03) },
  { id: "punta-sur", ...world(20.285, -86.99) },
];
const tulum = { id: "tulum", ...world(20.215, -87.429) };

test("screenDistance scales with zoom", () => {
  const d8 = screenDistance(cozumel[0], cozumel[1], 8);
  assert.ok(Math.abs(screenDistance(cozumel[0], cozumel[1], 9) - 2 * d8) < 1e-9);
});

test("screenDistance goes the short way across the antimeridian", () => {
  const fiji = world(-17.7, 179.9);
  const acrossTheLine = world(-17.7, -179.9);
  assert.ok(screenDistance(fiji, acrossTheLine, 10) < 200);
});

test("zoomed out, nearby spots share a group and distant ones don't", () => {
  const groups = clusterPoints([...cozumel, tulum], 8);
  assert.deepEqual(
    groups.map((g) => g.map((p) => p.id)),
    [["chankanaab", "palancar", "punta-sur"], ["tulum"]]
  );
});

test("zoomed in, every spot is on its own", () => {
  const groups = clusterPoints([...cozumel, tulum], 13);
  assert.equal(groups.length, 4);
  assert.ok(groups.every((g) => g.length === 1));
});

test("grouping is stable for the same input", () => {
  const points = [...cozumel, tulum];
  assert.deepEqual(clusterPoints(points, 9), clusterPoints(points, 9));
});

test("an empty map has no groups", () => {
  assert.deepEqual(clusterPoints([], 10), []);
});

test("spots on one hotel can't be split by zooming", () => {
  const hotel = world(20.5, -86.95);
  assert.equal(canSplit([hotel, { ...hotel }]), false);
  assert.equal(canSplit(cozumel), true);
});

test("coversAny finds a badge that would sit on a marker", () => {
  const badge = world(20.44, -86.9);
  const size = { width: 96, height: 26 };
  assert.equal(coversAny(badge, size, [{ ...cozumel[0], size: 14 }], 8), true);
  assert.equal(coversAny(badge, size, [{ ...cozumel[0], size: 14 }], 13), false);
  assert.equal(coversAny(badge, size, [], 8), false);
});

test("extentOf gives the centre and bounds", () => {
  const { lat, lng, bounds } = extentOf([{ lat: 20, lng: -87 }, { lat: 21, lng: -86 }]);
  assert.deepEqual(bounds, { south: 20, north: 21, west: -87, east: -86 });
  assert.equal(lat, 20.5);
  assert.equal(lng, -86.5);
});

test("extentOf crosses the antimeridian instead of spanning the globe", () => {
  const { lng, bounds } = extentOf([{ lat: -17, lng: 179 }, { lat: -18, lng: -179 }]);
  assert.equal(bounds.west, 179);
  assert.equal(bounds.east, -179);
  assert.ok(Math.abs(Math.abs(lng) - 180) < 1e-9);
});
