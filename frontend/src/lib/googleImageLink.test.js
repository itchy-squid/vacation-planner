// Run with `npm test` (Node's built-in test runner, no dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import { googleImageLink } from "./googleImageLink.js";

test("a Google Images link gives its image and the page it was on", () => {
  assert.deepEqual(
    googleImageLink(
      "https://www.google.com/imgres?imgurl=https%3A%2F%2Fcdn.example.com%2Fbeach.jpg&imgrefurl=https%3A%2F%2Fexample.com%2Ftour&tbnid=x",
    ),
    { image: "https://cdn.example.com/beach.jpg", page: "https://example.com/tour" },
  );
});

test("any Google site, with or without a scheme", () => {
  assert.equal(googleImageLink("google.co.uk/imgres?imgurl=https://x.com/a.jpg").image, "https://x.com/a.jpg");
  assert.equal(googleImageLink("https://images.google.fr/imgres?imgurl=https://x.com/a.jpg").image, "https://x.com/a.jpg");
});

test("only http(s) images come back", () => {
  assert.deepEqual(googleImageLink("https://www.google.com/imgres?imgurl=javascript:alert(1)"), { image: null, page: null });
});

test("other links aren't Google Images links", () => {
  assert.equal(googleImageLink("https://cdn.example.com/beach.jpg"), null);
  assert.equal(googleImageLink("https://www.google.com/maps/place/Eiffel+Tower"), null);
  assert.equal(googleImageLink("https://notgoogle.com/imgres?imgurl=https://x.com/a.jpg"), null);
  assert.equal(googleImageLink(""), null);
});
