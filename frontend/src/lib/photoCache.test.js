// Run with `npm test` (Node's built-in test runner, no dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEP_STORED_MS, MAX_STORED_PLACES, STORAGE_KEY, forgetStoredPhotos, readStoredPhotos, storePhotos } from "./photoCache.js";

function memoryStorage() {
  const items = new Map();
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
  };
}

const PHOTOS = [{ src: "https://example.test/a.jpg", credit: [{ name: "Ana", uri: "" }] }];

test("stored photos come back until they're a day old", () => {
  const storage = memoryStorage();
  storePhotos(storage, "place-1", PHOTOS, 1000);
  assert.deepEqual(readStoredPhotos(storage, "place-1", 1000 + KEEP_STORED_MS - 1), PHOTOS);
  assert.equal(readStoredPhotos(storage, "place-1", 1000 + KEEP_STORED_MS), null);
});

test("an unknown place has nothing stored", () => {
  assert.equal(readStoredPhotos(memoryStorage(), "nowhere", 0), null);
});

test("forgetting a place drops only that place", () => {
  const storage = memoryStorage();
  storePhotos(storage, "place-1", PHOTOS, 0);
  storePhotos(storage, "place-2", PHOTOS, 0);
  forgetStoredPhotos(storage, "place-1");
  assert.equal(readStoredPhotos(storage, "place-1", 0), null);
  assert.deepEqual(readStoredPhotos(storage, "place-2", 0), PHOTOS);
});

test("storing drops stale places and keeps the newest past the cap", () => {
  const storage = memoryStorage();
  storePhotos(storage, "stale", PHOTOS, 0);
  const now = KEEP_STORED_MS + 10;
  for (let i = 0; i <= MAX_STORED_PLACES; i += 1) storePhotos(storage, `place-${i}`, PHOTOS, now + i);
  const kept = Object.keys(JSON.parse(storage.getItem(STORAGE_KEY)));
  assert.equal(kept.length, MAX_STORED_PLACES);
  assert.ok(!kept.includes("stale"));
  assert.ok(!kept.includes("place-0"), "the oldest goes first");
  assert.ok(kept.includes(`place-${MAX_STORED_PLACES}`));
});

test("unreadable or throwing storage is treated as empty", () => {
  const garbled = memoryStorage();
  garbled.setItem(STORAGE_KEY, "{not json");
  assert.equal(readStoredPhotos(garbled, "place-1", 0), null);
  storePhotos(garbled, "place-1", PHOTOS, 0);
  assert.deepEqual(readStoredPhotos(garbled, "place-1", 0), PHOTOS);

  const throwing = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("full");
    },
  };
  assert.equal(readStoredPhotos(throwing, "place-1", 0), null);
  assert.doesNotThrow(() => storePhotos(throwing, "place-1", PHOTOS, 0));
  assert.doesNotThrow(() => forgetStoredPhotos(throwing, "place-1"));
  assert.equal(readStoredPhotos(null, "place-1", 0), null);
});
