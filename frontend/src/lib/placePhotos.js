// A Google place's own photos, for ideas that are a Google place
// (docs/features/pin-photos-spec.md, "From Google Maps"). Runs in the
// browser through the Maps JS "places" library, on the same key as the map.
//
// Google's terms don't allow keeping these photos, or their names, so a pin
// stores only which of its place's photos it uses (backend models.py
// Pin.photo_google_index) and the image is looked up here each time it's
// shown. Both the lookup and every photo shown are billed, so a place's
// photos are kept in memory for a while (a board that draws the same place
// twice, or comes back to it, asks once) and in this browser's storage for a
// day (lib/photoCache.js), so a reload or a new tab doesn't ask again.
import { importMapsLibrary, isMapsConfigured } from "./googleMaps";
import { browserStorage, forgetStoredPhotos, readStoredPhotos, storePhotos } from "./photoCache";

// Google returns at most ten; the backend accepts indexes 0 to 9.
export const MAX_PLACE_PHOTOS = 10;
const PHOTO_WIDTH = 800;
const KEEP_MS = 30 * 60 * 1000;

const lookups = new Map(); // placeId -> { at, photos: Promise, found? (once resolved) }

/**
 * Resolves to the place's photos, best first: [{ src, credit }], where
 * credit is the photographers Google says must be named wherever the photo
 * is shown ([{ name, uri }]). Empty when Maps isn't set up here.
 */
export function placePhotos(placeId) {
  if (!placeId || !isMapsConfigured) return Promise.resolve([]);
  const kept = lookups.get(placeId);
  if (kept && Date.now() - kept.at < KEEP_MS) return kept.photos;
  const stored = readStoredPhotos(browserStorage(), placeId);
  const photos = stored
    ? Promise.resolve(stored)
    : lookUp(placeId).then(
        (found) => {
          storePhotos(browserStorage(), placeId, found);
          return found;
        },
        (err) => {
          // A failed lookup isn't kept: the next view asks again.
          lookups.delete(placeId);
          throw err;
        },
      );
  const entry = { at: Date.now(), photos };
  photos.then((found) => (entry.found = found), () => {});
  lookups.set(placeId, entry);
  return photos;
}

/**
 * Forgets the place's photos, in memory and in storage, so the next
 * placePhotos asks Google again: for when its photo at src has stopped
 * loading. Only while what's kept still has that src, so every card of the
 * same place failing at once leads to one new lookup, not one each.
 */
export function forgetPlacePhotos(placeId, src) {
  const kept = lookups.get(placeId);
  if (kept && !kept.found) return; // a lookup is already under way
  if (kept && !kept.found.some((photo) => photo.src === src)) return;
  lookups.delete(placeId);
  forgetStoredPhotos(browserStorage(), placeId);
}

async function lookUp(placeId) {
  const { Place } = await importMapsLibrary("places");
  const place = new Place({ id: placeId });
  await place.fetchFields({ fields: ["photos"] });
  return (place.photos ?? []).slice(0, MAX_PLACE_PHOTOS).map((photo) => ({
    src: photo.getURI({ maxWidth: PHOTO_WIDTH }),
    credit: (photo.authorAttributions ?? []).map((author) => ({ name: author.displayName ?? "", uri: author.uri ?? "" })),
  }));
}
