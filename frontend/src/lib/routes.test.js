// Run with `npm test` (Node's built-in test runner, no dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fareCents, nextDeparture, readRoute, roundUpTo5, routeRequest, straightLineMeters, summarize } from "./routes.js";

const PLAYA = { lat: 20.6296, lng: -87.0739 };
const TULUM = { lat: 20.215, lng: -87.429 };

const walkStep = (min) => ({ travelMode: "WALKING", staticDurationMillis: min * 60000 });
const transitStep = (min, type, shortName = "") => ({
  travelMode: "TRANSIT",
  staticDurationMillis: min * 60000,
  transitDetails: { transitLine: { shortName, vehicle: { type } } },
});
const route = (minutes, steps = [], extra = {}) => ({ durationMillis: minutes * 60000, distanceMeters: 58000, legs: [{ steps }], path: [], ...extra });

test("straight-line distance is in metres", () => {
  const m = straightLineMeters(PLAYA, TULUM);
  assert.ok(m > 55000 && m < 60000, `${m}`);
});

test("rides round up to the next five minutes, and never to nothing", () => {
  assert.equal(roundUpTo5(41), 45);
  assert.equal(roundUpTo5(45), 45);
  assert.equal(roundUpTo5(0.5), 5);
});

test("bus and train are transit with a preferred vehicle; walking and driving aren't", () => {
  assert.deepEqual(routeRequest(PLAYA, TULUM, "bus").transitPreference, { allowedTransitModes: ["BUS"] });
  assert.equal(routeRequest(PLAYA, TULUM, "train").travelMode, "TRANSIT");
  assert.equal(routeRequest(PLAYA, TULUM, "car").travelMode, "DRIVING");
  assert.equal(routeRequest(PLAYA, TULUM, "walk", new Date()).departureTime, undefined);
});

test("a train route counts only if a train is in it", () => {
  const busOnly = route(80, [walkStep(5), transitStep(70, "BUS"), walkStep(5)]);
  assert.deepEqual(readRoute(busOnly, "train"), { available: false, reason: "No train goes there" });
  const byTrain = readRoute(route(62, [walkStep(8), transitStep(45, "HEAVY_RAIL", "Tren Maya"), walkStep(9)]), "train");
  assert.equal(byTrain.available, true);
  assert.equal(byTrain.minutes, 65);
  assert.equal(byTrain.summary, "Walk 8m · Tren Maya 45m · Walk 9m");
});

test("walks next to each other read as one", () => {
  assert.equal(
    summarize([{ kind: "walk", minutes: 3 }, { kind: "walk", minutes: 4 }, { kind: "bus", minutes: 30, line: "" }]),
    "Walk 7m · Bus 30m"
  );
});

test("a walk that takes hours isn't offered", () => {
  const result = readRoute({ durationMillis: 200 * 60000, distanceMeters: 15000, legs: [] }, "walk");
  assert.deepEqual(result, { available: false, reason: "Too far to walk (15 km)" });
});

test("a distance comes back in whole metres", () => {
  assert.equal(readRoute({ durationMillis: 600000, distanceMeters: 8819.6, legs: [] }, "car").distanceMeters, 8820);
});

test("no route is no route", () => {
  assert.equal(readRoute(undefined, "car").available, false);
  assert.equal(readRoute(undefined, "bus").reason, "No bus goes there");
});

test("a fare counts only in dollars", () => {
  assert.equal(fareCents({ currencyCode: "USD", units: "12", nanos: 500000000 }), 1250);
  assert.equal(fareCents({ currencyCode: "MXN", units: 250 }), null);
  assert.equal(fareCents(undefined), null);
  assert.equal(readRoute(route(30, [transitStep(25, "BUS")], { travelAdvisory: { transitFare: { currencyCode: "USD", units: 3 } } }), "bus").fareCents, 300);
});

test("a path comes back as plain coordinates, from getters or numbers", () => {
  const path = [{ lat: () => 1, lng: () => 2 }, { lat: 3, lng: 4 }];
  assert.deepEqual(readRoute(route(10, [], { path }), "car").path, [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }]);
});

test("a departure lands on the trip day's weekday and hour, at least an hour away", () => {
  const now = new Date(2026, 8, 29, 10, 0); // a Tuesday
  const monday9 = nextDeparture(now, 1, 540);
  assert.equal(monday9.getDay(), 1);
  assert.equal(monday9.getHours() * 60 + monday9.getMinutes(), 540);
  assert.ok(monday9 > now);
  const soon = nextDeparture(now, 2, 630); // today, 10:30: too soon, so next week
  assert.equal(soon.getDate(), 6);
});
