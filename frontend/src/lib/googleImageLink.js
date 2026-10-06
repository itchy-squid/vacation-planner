// A link copied from Google Images ("google.com/imgres?imgurl=…") is
// Google's page about the image, not the image, so it shows nothing when
// used as a photo. The real image and the page it was found on are in its
// query string. The backend reads the same links when they're an idea's
// link (backend/app/link_photos.py _unwrap_google).
const GOOGLE_HOST = /^(?:www\.|images\.)?google\.(?:com?\.)?[a-z]{2,3}$/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

// { image, page } for a Google Images link, or null for any other link.
// Only http(s) URLs come back; either can be null when Google's link is
// missing it.
export function googleImageLink(link) {
  const trimmed = (link ?? "").trim();
  if (!trimmed) return null;
  let url;
  try {
    url = new globalThis.URL(HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (!GOOGLE_HOST.test(url.hostname) || url.pathname !== "/imgres") return null;
  return { image: webUrl(url.searchParams.get("imgurl")), page: webUrl(url.searchParams.get("imgrefurl")) };
}

function webUrl(value) {
  try {
    const url = new globalThis.URL((value ?? "").trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
