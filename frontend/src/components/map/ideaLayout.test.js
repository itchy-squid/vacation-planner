// Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { WORLD_SIZE } from "../../lib/clusters.js";
import { cameraFor, expansionZoom, layoutIdeas } from "./ideaLayout.js";

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

test("before the map has drawn, every spot is a dot", () => {
  const out = layoutIdeas({ pins, regions: [cozumel], view: null });
  assert.deepEqual(idsOf(out.dots), [1, 2, 3, 4]);
  assert.deepEqual(out.clusters, []);
  assert.equal(out.compactKeys.size, 0);
});

test("zoomed out, nearby spots become a bubble that counts exact spots only", () => {
  const { dots, clusters } = layoutIdeas({ pins, regions: [cozumel, valladolid], view: at(8) });
  assert.equal(clusters.length, 1);
  assert.deepEqual(idsOf(clusters[0].pins), [1, 2, 3]);
  assert.equal(clusters[0].count, 3);
  assert.deepEqual(idsOf(dots), [4]);
});

test("a region badge that would cover a bubble stays separate, shrunk to its count", () => {
  const { clusters, compactKeys } = layoutIdeas({ pins, regions: [cozumel, valladolid], view: at(8) });
  assert.equal(clusters[0].count, 3);
  assert.ok(compactKeys.has("cozumel"));
  assert.equal(compactKeys.has("valladolid"), false);
});

test("zoomed in, the badge has room for its name again", () => {
  const { clusters, compactKeys } = layoutIdeas({ pins, regions: [cozumel], view: at(12) });
  assert.equal(clusters.length, 0);
  assert.equal(compactKeys.has("cozumel"), false);
});

test("a badge that would cover a single dot shows just its count", () => {
  const lone = [{ id: 9, title: "San Miguel pier", lat: 20.42, lng: -86.925 }];
  const { clusters, compactKeys } = layoutIdeas({ pins: lone, regions: [cozumel], view: at(11) });
  assert.equal(clusters.length, 0);
  assert.ok(compactKeys.has("cozumel"));
});

test("the selected idea never goes into a bubble", () => {
  const { dots, clusters } = layoutIdeas({ pins, regions: [], highlightedId: 3, view: at(8) });
  assert.deepEqual(idsOf(clusters[0].pins), [1, 2]);
  assert.deepEqual(idsOf(dots), [3, 4]);
});

const holdsTogether = (cluster, input, zoom) => {
  const { clusters } = layoutIdeas({ ...input, view: at(zoom) });
  return clusters.some((c) => c.key === cluster.key);
};

test("tapping a bubble zooms in just far enough for it to break up", () => {
  const input = { pins, regions: [cozumel], view: at(8) };
  const [cluster] = layoutIdeas(input).clusters;
  const zoom = expansionZoom(cluster, input);
  assert.ok(zoom > 8 && zoom <= 12, `zoom ${zoom}`);
  assert.equal(holdsTogether(cluster, input, zoom), false);
  // One level less and it would still be whole (unless that's where we are).
  if (zoom - 1 > 8) assert.equal(holdsTogether(cluster, input, zoom - 1), true);
});

test("ideas on one spot never break up, so they're listed instead", () => {
  const hotel = [
    { id: 7, title: "Breakfast", lat: 20.5, lng: -86.95 },
    { id: 8, title: "Spa", lat: 20.5, lng: -86.95 },
  ];
  const input = { pins: hotel, regions: [], view: at(10) };
  const [cluster] = layoutIdeas(input).clusters;
  assert.equal(expansionZoom(cluster, input), null);
});

test("the camera centres the bubble in the part of the map the header leaves", () => {
  const cluster = { lat: 20.36, lng: -86.99 };
  const plain = cameraFor(cluster, 10, {}, toWorld);
  assert.ok(Math.abs(plain.center.lat - 20.36) < 1e-9 && Math.abs(plain.center.lng + 86.99) < 1e-9);
  // A 76px header over a 28px bottom margin: the map's own centre sits
  // 24px above the bubble, so the bubble lands mid-way down the clear part.
  const underHeader = cameraFor(cluster, 10, { top: 76, bottom: 28, left: 28, right: 28 }, toWorld);
  assert.ok(underHeader.center.lat > 20.36);
  assert.ok(Math.abs(underHeader.center.lng + 86.99) < 1e-9);
  const shiftPx = (toWorld(cluster).y - toWorld(underHeader.center).y) * 2 ** 10;
  assert.ok(Math.abs(shiftPx - 24) < 1e-6);
});
