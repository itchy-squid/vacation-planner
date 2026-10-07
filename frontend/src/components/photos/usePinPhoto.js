import { useEffect, useState } from "react";
import { placePhotos } from "../../lib/placePhotos";

// The browser's default: just this site's origin, which is what the Maps
// key's referrer restriction checks.
export const GOOGLE_REFERRER_POLICY = "strict-origin-when-cross-origin";

/**
 * The photo to draw for a pin: { src, credit }. A link photo is its
 * photoUrl, with no credit; a Google one (photoGoogleIndex set) is looked
 * up from the pin's place (lib/placePhotos.js) and comes with the
 * photographers that have to be named beside it (components/photos/
 * PhotoCredit.jsx). src is "" for no photo, while a Google photo is still
 * loading, and when Google no longer has it: callers show the placeholder.
 * referrerPolicy is how to load it: a link photo is loaded without a
 * referrer, so sites that block hotlinking can't refuse it; a Google one
 * keeps it, since the Maps key is restricted to this site by referrer.
 */
export function usePinPhoto({ photoUrl, googlePlaceId, photoGoogleIndex }) {
  const key = googlePlaceId && photoGoogleIndex != null ? `${googlePlaceId}#${photoGoogleIndex}` : null;
  const [found, setFound] = useState(null); // { key, photo }

  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    placePhotos(googlePlaceId)
      .then((photos) => !cancelled && setFound({ key, photo: photos[photoGoogleIndex] ?? null }))
      .catch(() => !cancelled && setFound({ key, photo: null }));
    return () => {
      cancelled = true;
    };
  }, [key, googlePlaceId, photoGoogleIndex]);

  if (!key) return { src: photoUrl || "", credit: [], referrerPolicy: "no-referrer" };
  const photo = found?.key === key ? found.photo : null;
  return { src: photo?.src ?? "", credit: photo?.credit ?? [], referrerPolicy: GOOGLE_REFERRER_POLICY };
}
