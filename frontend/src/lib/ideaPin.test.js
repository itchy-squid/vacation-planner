import { test } from "node:test";
import assert from "node:assert/strict";
import { planHasIdea } from "./ideaPin.js";

const pins = {
  1: { id: 1, lat: 20.4, lng: -86.9 },
  2: { id: 2, lat: null, lng: null },
};

test("a plan with an idea in it gets the pin, with or without a map spot", () => {
  assert.equal(planHasIdea({ items: [{ pinId: 1 }] }, pins), true);
  assert.equal(planHasIdea({ items: [{ pinId: 2 }] }, pins), true);
  assert.equal(planHasIdea({ items: [{ travelItemId: 9 }, { pinId: 2 }] }, pins), true);
});

test("a ride or a custom event gets no pin", () => {
  assert.equal(planHasIdea({ items: [{ travelItemId: 9 }] }, pins), false);
  assert.equal(planHasIdea({ items: [], label: "Dinner with Ana" }, pins), false);
  assert.equal(planHasIdea({ label: "Dinner with Ana" }, pins), false);
  assert.equal(planHasIdea({ items: [{ pinId: 99 }] }, pins), false);
});
