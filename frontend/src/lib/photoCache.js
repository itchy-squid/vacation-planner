// Keeps a Google place's photo lookups (lib/placePhotos.js) in the browser's
// localStorage, so a reload, a new tab or coming back tomorrow doesn't pay
// for the same Place Details lookup again. Only this browser sees it: the
// photos still never reach our own storage (docs/features/pin-photos-spec.md,
// "From Google Maps").
//
// Google's photo links can stop working before an entry is old, so callers
// forget a place whose photo fails to load and look it up again
// (components/photos/usePinPhoto.js).
//
// Every call takes the storage to use and is a no-op without one, and
// storage can throw (private browsing, disabled or full storage), so a
// cache that can't be read or written just means asking Google again.

export const STORAGE_KEY = "placePhotos.v1";
export const KEEP_STORED_MS = 24 * 60 * 60 * 1000;
// Enough for every place on a few trips; the oldest go first past it.
export const MAX_STORED_PLACES = 300;

function readAll(storage) {
  try {
    const all = JSON.parse(storage?.getItem(STORAGE_KEY) || "{}");
    return all && typeof all === "object" && !Array.isArray(all) ? all : {};
  } catch {
    return {};
  }
}

function writeAll(storage, all) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Full or unavailable: the next view asks Google again.
  }
}

/** The place's stored photos ([{ src, credit }]), or null if none are fresh. */
export function readStoredPhotos(storage, placeId, now = Date.now()) {
  const entry = readAll(storage)[placeId];
  if (!entry || !Array.isArray(entry.photos) || !(now - entry.at < KEEP_STORED_MS) || entry.at > now) return null;
  return entry.photos;
}

/** Stores the place's photos, dropping stale entries and the oldest past the cap. */
export function storePhotos(storage, placeId, photos, now = Date.now()) {
  if (!storage) return;
  const all = readAll(storage);
  all[placeId] = { at: now, photos };
  const kept = Object.entries(all)
    .filter(([, entry]) => entry && now - entry.at < KEEP_STORED_MS && entry.at <= now)
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, MAX_STORED_PLACES);
  writeAll(storage, Object.fromEntries(kept));
}

/** Drops the place's stored photos. */
export function forgetStoredPhotos(storage, placeId) {
  if (!storage) return;
  const all = readAll(storage);
  if (!(placeId in all)) return;
  delete all[placeId];
  writeAll(storage, all);
}

/** window.localStorage, or null where it can't be reached. */
export function browserStorage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}
