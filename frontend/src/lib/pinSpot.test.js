import { test } from "node:test";
import assert from "node:assert/strict";
import { hasSpot, planSpot } from "./pinSpot.js";

const pins = {
  1: { id: 1, lat: 20.4, lng: -86.9 },
  2: { id: 2, lat: null, lng: null },
  3: { id: 3, lat: 20.2, lng: -87.4 },
};

test("an idea has a spot only with both a lat and a lng", () => {
  assert.equal(hasSpot(pins[1]), true);
  assert.equal(hasSpot(pins[2]), false);
  assert.equal(hasSpot({ lat: 1, lng: null }), false);
  assert.equal(hasSpot(undefined), false);
});

test("a plan is on the map when every idea in it is", () => {
  assert.equal(planSpot({ items: [{ pinId: 1 }, { pinId: 3 }] }, pins), "spot");
  assert.equal(planSpot({ items: [{ pinId: 1 }, { pinId: 2 }] }, pins), "none");
});

test("a ride or a custom event gets no mark", () => {
  assert.equal(planSpot({ items: [{ travelItemId: 9 }] }, pins), null);
  assert.equal(planSpot({ items: [] }, pins), null);
  assert.equal(planSpot({ items: [{ pinId: 99 }] }, pins), null);
});
