// Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { WORLD_SIZE } from "../../lib/clusters.js";
import { layoutIdeas } from "./ideaLayout.js";

// Stands in for map.getProjection().fromLatLngToPoint (Web Mercator).
function toWorld({ lat, lng }) {
  const sin = Math.sin((lat * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * WORLD_SIZE, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * WORLD_SIZE };
}
const at = (zoom) => ({ zoom, toWorld });

const pins = [
  { id: 1, title: "Chankanaab Park", lat: 20.443, lng: -86.998 },
  { id: 2, title: "Palancar Reef", lat: 20.33, lng: -87.03 },
  { id: 3, title: "Punta Sur", lat: 20.285, lng: -86.99, photoUrl: "https://example.com/p.jpg" },
  { id: 4, title: "Tulum ruins", lat: 20.215, lng: -87.429 },
];
const cozumel = { key: "cozumel", name: "Cozumel", lat: 20.42, lng: -86.92, count: 2 };
// Inland, clear of every spot above.
const valladolid = { key: "valladolid", name: "Valladolid", lat: 20.69, lng: -88.2, count: 1 };
const idsOf = (list) => list.map((p) => p.id).sort();
const keysOf = (list) => list.map((r) => r.key).sort();

test("before the map has drawn, every spot is a dot and every region a badge", () => {
  const out = layoutIdeas({ pins, regions: [cozumel], view: null });
  assert.deepEqual(idsOf(out.dots), [1, 2, 3, 4]);
  assert.deepEqual(out.clusters, []);
  assert.deepEqual(keysOf(out.badges), ["cozumel"]);
  assert.equal(out.compactKeys.size, 0);
});

test("zoomed out, nearby spots become a bubble", () => {
  const { dots, clusters } = layoutIdeas({ pins, regions: [], view: at(8) });
  assert.equal(clusters.length, 1);
  assert.deepEqual(idsOf(clusters[0].pins), [1, 2, 3]);
  assert.equal(clusters[0].count, 3);
  assert.equal(clusters[0].splittable, true);
  assert.deepEqual(idsOf(dots), [4]);
});

test("a region badge that would cover a bubble is counted in it", () => {
  const { clusters, badges } = layoutIdeas({ pins, regions: [cozumel, valladolid], view: at(8) });
  assert.deepEqual(keysOf(clusters[0].regions), ["cozumel"]);
  assert.equal(clusters[0].count, 5);
  assert.deepEqual(keysOf(badges), ["valladolid"]);
});

test("zoomed in, the region's badge comes back out of the bubble", () => {
  const { clusters, badges } = layoutIdeas({ pins, regions: [cozumel], view: at(12) });
  assert.equal(clusters.length, 0);
  assert.deepEqual(keysOf(badges), ["cozumel"]);
});

test("a selected region keeps its badge, shrunk to its count", () => {
  const { clusters, badges, compactKeys } = layoutIdeas({ pins, regions: [cozumel], selectedRegionKey: "cozumel", view: at(8) });
  assert.equal(clusters[0].count, 3);
  assert.deepEqual(keysOf(badges), ["cozumel"]);
  assert.equal(compactKeys.has("cozumel"), false);
});

test("a badge that would cover a single dot shows just its count", () => {
  const lone = [{ id: 9, title: "San Miguel pier", lat: 20.42, lng: -86.925 }];
  const { clusters, badges, compactKeys } = layoutIdeas({ pins: lone, regions: [cozumel], view: at(11) });
  assert.equal(clusters.length, 0);
  assert.deepEqual(keysOf(badges), ["cozumel"]);
  assert.ok(compactKeys.has("cozumel"));
});

test("the selected idea never goes into a bubble", () => {
  const { dots, clusters } = layoutIdeas({ pins, regions: [], highlightedId: 3, view: at(8) });
  assert.deepEqual(idsOf(clusters[0].pins), [1, 2]);
  assert.deepEqual(idsOf(dots), [3, 4]);
});

test("ideas on one spot make a bubble that can't be split", () => {
  const hotel = [
    { id: 7, title: "Breakfast", lat: 20.5, lng: -86.95 },
    { id: 8, title: "Spa", lat: 20.5, lng: -86.95 },
  ];
  const { clusters } = layoutIdeas({ pins: hotel, regions: [], view: at(21) });
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].splittable, false);
});
