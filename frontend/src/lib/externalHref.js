// A link someone typed or pasted onto a pin or travel item, made safe to
// open. Links are stored as entered, often with no scheme ("maps.app/…"),
// and window.open would resolve those relative to this app, so https:// is
// added when there isn't one. Only http(s) ever comes back: a
// "javascript:" or "data:" link would run in whoever clicks it, so it
// yields null and callers show no link at all. The backend refuses to
// store those too (backend/app/schemas.py WebLink); this is the half that
// also covers anything saved before that check existed.
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export function externalHref(link) {
  const trimmed = (link ?? "").trim();
  if (!trimmed) return null;
  const candidate = HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    // URL parsing applies the browser's own normalisation (dropped tabs
    // and newlines, lower-cased scheme), so the protocol read here is the
    // one the browser would actually use.
    const url = new window.URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
