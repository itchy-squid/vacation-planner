// A Google place's own photos, for ideas that are a Google place
// (docs/features/pin-photos-spec.md, "From Google Maps"). Runs in the
// browser through the Maps JS "places" library, on the same key as the map.
//
// Google's terms don't allow keeping these photos, or their names, so a pin
// stores only which of its place's photos it uses (backend models.py
// Pin.photo_google_index) and the image is looked up here each time it's
// shown. Both the lookup and every photo shown are billed, so a place's
// photos are kept in memory for a while: a board that draws the same place
// twice, or comes back to it, asks once.
import { importMapsLibrary, isMapsConfigured } from "./googleMaps";

// Google returns at most ten; the backend accepts indexes 0 to 9.
export const MAX_PLACE_PHOTOS = 10;
const PHOTO_WIDTH = 800;
const KEEP_MS = 30 * 60 * 1000;

const lookups = new Map(); // placeId -> { at, photos: Promise }

/**
 * Resolves to the place's photos, best first: [{ src, credit }], where
 * credit is the photographers Google says must be named wherever the photo
 * is shown ([{ name, uri }]). Empty when Maps isn't set up here.
 */
export function placePhotos(placeId) {
  if (!placeId || !isMapsConfigured) return Promise.resolve([]);
  const kept = lookups.get(placeId);
  if (kept && Date.now() - kept.at < KEEP_MS) return kept.photos;
  const photos = lookUp(placeId).catch((err) => {
    // A failed lookup isn't kept: the next view asks again.
    lookups.delete(placeId);
    throw err;
  });
  lookups.set(placeId, { at: Date.now(), photos });
  return photos;
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
