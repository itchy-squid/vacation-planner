import { useEffect, useState } from "react";
import { isMapsConfigured } from "../../lib/googleMaps";
import { searchPlaces } from "../../lib/places";
import { estimateLeg } from "../../lib/routeEstimates";
import { MODES, formatDistance, straightLineMeters } from "../../lib/routes";
import { flightMinutes } from "../../lib/travel";

// How long to wait after the last keystroke in From or To before asking
// Google where that is.
const TYPING_PAUSE_MS = 600;

// A typed place's best match, asked once per page for each text and area.
const found = new Map();

function findPlace(label, bias) {
  const key = `${label.toLowerCase()}|${bias ? [bias.south, bias.west, bias.north, bias.east].join(",") : ""}`;
  if (!found.has(key)) {
    const pending = searchPlaces(label, { bias, max: 1 }).then((results) => results[0] ?? null);
    pending.catch(() => found.delete(key));
    found.set(key, pending);
  }
  return found.get(key);
}

/**
 * Google's time for one leg of travel in the Travel form
 * (TravelForm.jsx) or a "+ travel" chip (TravelGapChip.jsx), for the mode
 * picked. A flight has no Google time: its airports are found on Google
 * and its time guessed from the distance (lib/travel.js flightMinutes),
 * marked `guess`. Each end is { label, point }: a point when it's an idea
 * on the map, otherwise the typed label is looked up as a place,
 * preferring ones in `bias`. `departure` times bus and train
 * (lib/routes.js nextDeparture).
 *
 *   { status: "off" }        nothing to ask: no Maps key, "other", or an
 *                            end blank
 *   { status: "loading" }
 *   { status: "missing", end: "from" | "to" }   Google didn't know a place
 *   { status: "error" }      Google couldn't be reached
 *   { status: "ready", estimate, from, to }     estimate is lib/routes.js
 *                            readRoute's; from and to the places it used
 */
export function useTravelEstimate({ mode, from, to, departure, bias }) {
  const [answer, setAnswer] = useState({ status: "off" });
  const fromLabel = from.label.trim();
  const toLabel = to.label.trim();
  const flight = mode === "flight";
  const on = isMapsConfigured && (flight || MODES.includes(mode)) && fromLabel && toLabel;
  const when = departure ? departure.getTime() : 0;
  const fromKey = from.point ? `${from.point.lat},${from.point.lng}` : fromLabel;
  const toKey = to.point ? `${to.point.lat},${to.point.lng}` : toLabel;
  const biasKey = bias ? [bias.south, bias.west, bias.north, bias.east].join(",") : "";

  useEffect(() => {
    if (!on) {
      setAnswer({ status: "off" });
      return undefined;
    }
    let live = true;
    setAnswer({ status: "loading" });
    // Airports can be anywhere: a flight's aren't looked for near the trip.
    const near = flight ? null : bias;
    const where = (end) => (end.point ? Promise.resolve({ name: end.label.trim(), ...end.point }) : findPlace(end.label.trim(), near));
    // Ideas on the map are asked straight away; typing waits for a pause.
    const wait = from.point && to.point ? 0 : TYPING_PAUSE_MS;
    const timer = setTimeout(async () => {
      try {
        const [a, b] = await Promise.all([where(from), where(to)]);
        if (!live) return;
        if (!a || !b) {
          setAnswer({ status: "missing", end: a ? "to" : "from" });
          return;
        }
        const meters = straightLineMeters(a, b);
        const estimate = flight
          ? { available: true, guess: true, minutes: flightMinutes(meters), distanceMeters: Math.round(meters), summary: formatDistance(meters) }
          : await estimateLeg(a, b, mode, { departure });
        if (live) setAnswer({ status: "ready", estimate, from: a, to: b });
      } catch {
        if (live) setAnswer({ status: "error" });
      }
    }, wait);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // The keys are what decide what to ask; the objects are rebuilt on
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, mode, fromKey, toKey, when, biasKey]);

  return answer;
}
