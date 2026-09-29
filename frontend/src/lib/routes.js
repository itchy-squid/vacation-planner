// Rides by car, bus, train or on foot: what to ask Google's Routes service
// and how to read its answer, for the Map tab's trip builder
// (pages/PlanTrip.jsx).
//
// Bus and train are both Google's TRANSIT mode, told which vehicles to
// prefer. A preference isn't a promise, so a route only counts as "by
// train" if a train is actually in it; otherwise that mode says there's
// no train, rather than quietly offering a bus under the train's name.
//
// Everything here is pure and tested (routes.test.js); asking Google is
// lib/routeEstimates.js.

export const MODES = ["car", "bus", "train", "walk"];
export const MODE_LABELS = { car: "Car", bus: "Bus", train: "Train", walk: "Walk" };

// Further than this as the crow flies and walking isn't offered at all —
// no request is spent finding out it takes all day.
export const WALK_LIMIT_METERS = 8000;
// A walk that turns out longer than this (around a bay, say) isn't one.
export const WALK_LIMIT_MINUTES = 150;

const BUS_VEHICLES = new Set(["BUS", "INTERCITY_BUS", "TROLLEYBUS", "SHARE_TAXI"]);
const TRAIN_VEHICLES = new Set([
  "RAIL",
  "METRO_RAIL",
  "SUBWAY",
  "TRAM",
  "MONORAIL",
  "HEAVY_RAIL",
  "COMMUTER_TRAIN",
  "HIGH_SPEED_TRAIN",
  "LONG_DISTANCE_TRAIN",
]);

const REQUESTS = {
  car: { travelMode: "DRIVING" },
  walk: { travelMode: "WALKING" },
  bus: { travelMode: "TRANSIT", transitPreference: { allowedTransitModes: ["BUS"] } },
  train: { travelMode: "TRANSIT", transitPreference: { allowedTransitModes: ["TRAIN", "RAIL", "SUBWAY", "LIGHT_RAIL"] } },
};
const FIELDS = ["durationMillis", "staticDurationMillis", "distanceMeters", "path", "legs", "travelAdvisory"];

/** Great-circle distance in metres between two { lat, lng }. */
export function straightLineMeters(a, b) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/** Minutes, rounded up to the next 5: the calendar's own grain for a ride. */
export function roundUpTo5(minutes) {
  return Math.max(5, Math.ceil(minutes / 5) * 5);
}

export function formatDistance(meters) {
  if (meters == null) return "";
  const km = meters / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

/**
 * The next moment on `weekday` (0 = Sunday) at `minuteOfDay`, at least an
 * hour from `now`. Google only times transit a few weeks either side of
 * today, so a trip months away is timed on the same weekday and hour soon:
 * timetables repeat by the week, which is what the estimate is for.
 */
export function nextDeparture(now, weekday, minuteOfDay) {
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(minuteOfDay / 60), minuteOfDay % 60);
  const earliest = now.getTime() + 3600000;
  while (t.getDay() !== weekday || t.getTime() < earliest) t.setDate(t.getDate() + 1);
  return t;
}

/** The request for one ride (Route.computeRoutes). */
export function routeRequest(from, to, mode, departure) {
  const request = {
    origin: { lat: from.lat, lng: from.lng },
    destination: { lat: to.lat, lng: to.lng },
    fields: FIELDS,
    ...REQUESTS[mode],
  };
  if (departure && request.travelMode === "TRANSIT") request.departureTime = departure;
  return request;
}

function vehicleClass(step) {
  const vehicle = step.transitDetails?.transitLine?.vehicle;
  const type = String(vehicle?.type ?? vehicle?.vehicleType ?? "").toUpperCase();
  if (BUS_VEHICLES.has(type)) return "bus";
  if (TRAIN_VEHICLES.has(type)) return "train";
  return "other";
}

function stepKind(step) {
  const mode = String(step.travelMode ?? "").toUpperCase();
  if (mode === "WALKING" || mode === "WALK") return "walk";
  if (mode === "TRANSIT") return vehicleClass(step);
  return "drive";
}

const STEP_LABELS = { walk: "Walk", bus: "Bus", train: "Train", other: "Transit", drive: "Drive" };

/**
 * A transit ride's parts, consecutive walks merged: "Walk 6m · Bus 42m ·
 * Walk 3m". Lines are named when Google names them.
 */
export function summarize(steps) {
  const parts = [];
  steps.forEach((step) => {
    const previous = parts[parts.length - 1];
    if (previous && previous.kind === "walk" && step.kind === "walk") previous.minutes += step.minutes;
    else parts.push({ ...step });
  });
  return parts
    .filter((p) => p.minutes > 0)
    .map((p) => `${p.line || STEP_LABELS[p.kind]} ${Math.max(1, Math.round(p.minutes))}m`)
    .join(" · ");
}

function millis(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function coordinate(point) {
  const lat = typeof point.lat === "function" ? point.lat() : point.lat;
  const lng = typeof point.lng === "function" ? point.lng() : point.lng;
  return { lat, lng };
}

/** A transit fare in cents, when Google gives one in dollars (the app's only currency). */
export function fareCents(fare) {
  if (!fare || fare.currencyCode !== "USD") return null;
  return Number(fare.units ?? 0) * 100 + Math.round(Number(fare.nanos ?? 0) / 1e7);
}

/**
 * One of Google's routes as the trip builder uses it:
 *   { available: true, minutes, distanceMeters, fareCents, summary, path }
 * or { available: false, reason } when the route isn't really this mode.
 */
export function readRoute(route, mode) {
  if (!route) return unavailable(mode);
  const ms = millis(route.durationMillis) ?? millis(route.staticDurationMillis);
  if (ms == null) return unavailable(mode);
  const steps = (route.legs ?? []).flatMap((leg) =>
    (leg.steps ?? []).map((step) => ({
      kind: stepKind(step),
      minutes: (millis(step.staticDurationMillis) ?? 0) / 60000,
      line: step.transitDetails?.transitLine?.shortName || "",
    }))
  );
  if ((mode === "bus" || mode === "train") && !steps.some((s) => s.kind === mode)) return unavailable(mode);
  const minutes = roundUpTo5(ms / 60000);
  if (mode === "walk" && minutes > WALK_LIMIT_MINUTES) {
    return { available: false, reason: `Too far to walk (${formatDistance(route.distanceMeters)})` };
  }
  return {
    available: true,
    minutes,
    // Whole metres: that's what a ride stores (TravelItem.distance_meters).
    distanceMeters: millis(route.distanceMeters) == null ? null : Math.round(Number(route.distanceMeters)),
    fareCents: fareCents(route.travelAdvisory?.transitFare),
    summary: mode === "bus" || mode === "train" ? summarize(steps) : formatDistance(route.distanceMeters),
    path: (route.path ?? []).map(coordinate),
  };
}

function unavailable(mode) {
  if (mode === "bus") return { available: false, reason: "No bus goes there" };
  if (mode === "train") return { available: false, reason: "No train goes there" };
  return { available: false, reason: "No route found" };
}
