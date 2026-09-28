// Loads the Google Maps JavaScript API once per page and hands out its
// libraries. There's no npm loader here on purpose: the whole job is one
// <script> tag plus google.maps.importLibrary, which is Google's own
// documented way to pull in individual libraries after the bootstrap.
//
// The key is a *browser* key: it ships in the built JS, like every Maps JS
// key, and is protected by the HTTP-referrer and API restrictions set on it
// in Google Cloud (see README "Google Maps"). Vite bakes both values in at
// build time, so changing them means rebuilding the frontend.
const API_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "").trim();
const MAP_ID = (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID ?? "").trim();

const SCRIPT_ORIGIN = "https://maps.googleapis.com/maps/api/js";
const READY_CALLBACK = "__vacationPlannerMapsReady";

export const isMapsConfigured = API_KEY.length > 0;

// A Cloud-styled map (the pale basemap, README "Google Maps"). Markers
// (components/map/MapMarker.jsx) only draw on a map that has a Map ID, so
// without one this falls back to DEMO_MAP_ID, Google's stand-in for
// development: the default style, with markers working.
export const mapId = MAP_ID || "DEMO_MAP_ID";

export class MapsNotConfiguredError extends Error {
  constructor() {
    super("No Google Maps API key is configured for this build.");
    this.name = "MapsNotConfiguredError";
  }
}

let bootstrap = null;

function loadScript() {
  if (bootstrap) return bootstrap;
  bootstrap = new Promise((resolve, reject) => {
    window[READY_CALLBACK] = () => {
      delete window[READY_CALLBACK];
      resolve(window.google.maps);
    };
    const params = new window.URLSearchParams({ key: API_KEY, v: "weekly", loading: "async", callback: READY_CALLBACK });
    const script = document.createElement("script");
    script.src = `${SCRIPT_ORIGIN}?${params}`;
    script.async = true;
    script.onerror = () => {
      // Forget the failed attempt so a retry makes a fresh <script>
      // instead of re-awaiting the same rejected promise.
      script.remove();
      delete window[READY_CALLBACK];
      bootstrap = null;
      reject(new Error("Couldn't load Google Maps."));
    };
    document.head.append(script);
  });
  return bootstrap;
}

/** Resolves to one Maps JS library ("maps", "geocoding", "marker", …). */
export async function importMapsLibrary(name) {
  if (!isMapsConfigured) throw new MapsNotConfiguredError();
  const maps = await loadScript();
  return maps.importLibrary(name);
}

// Google reports a rejected key (wrong referrer, API not enabled, billing
// off) by calling a global `gm_authFailure` rather than by failing the
// script load, and then paints its own error over every map on the page.
// This turns that one global into something components can subscribe to.
let authFailed = false;
const authListeners = new Set();

window.gm_authFailure = () => {
  authFailed = true;
  authListeners.forEach((listener) => listener());
};

/** Calls `listener` if Google rejects the key; returns an unsubscribe. */
export function onMapsAuthFailure(listener) {
  if (authFailed) {
    listener();
    return () => {};
  }
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}
