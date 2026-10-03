// Run with `npm test` (Node's built-in test runner, no dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import { searchBias } from "./placeBias.js";

const near = (actual, expected) => Object.keys(expected).forEach((k) => assert.ok(Math.abs(actual[k] - expected[k]) < 1e-9, `${k}: ${actual[k]} vs ${expected[k]}`));

test("a region-sized box goes through unchanged", () => {
  const box = { south: 22.3, west: 120.3, north: 22.4, east: 120.4 };
  assert.deepEqual(searchBias(box), box);
});

test("a map zoomed out to the world is narrowed to under 180° around its centre", () => {
  const bias = searchBias({ south: -60, west: -180, north: 75, east: 180 });
  near(bias, { south: -60, west: -89.95, north: 75, east: 89.95 });
});

test("a wide box across the 180° meridian keeps its centre", () => {
  // 100°E eastward to 60°W: 200° wide, centred on 160°W.
  const bias = searchBias({ south: -10, west: 100, north: 10, east: -60 });
  near(bias, { south: -10, west: 110.05, north: 10, east: -70.05 });
});

test("google.maps.LatLngBounds is read through its corners", () => {
  const point = (lat, lng) => ({ lat: () => lat, lng: () => lng });
  const bounds = { getSouthWest: () => point(20.2, -87.1), getNorthEast: () => point(20.6, -86.7) };
  assert.deepEqual(searchBias(bounds), { south: 20.2, west: -87.1, north: 20.6, east: -86.7 });
});

test("nothing usable means no bias", () => {
  assert.equal(searchBias(null), null);
  assert.equal(searchBias({ south: null, west: 1, north: 2, east: 3 }), null);
});
