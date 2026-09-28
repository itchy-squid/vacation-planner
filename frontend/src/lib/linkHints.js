// A title and a place, read from a booking site's link. Tours from
// Viator, GetYourGuide and the like usually aren't on Google Maps, but
// their links spell out the city and the tour's name:
//
//   viator.com/tours/Cozumel/Snorkel-and-Beach-Break/d632-5512P3
//   getyourguide.com/cozumel-l1234/cozumel-snorkel-tour-t56789/
//
// Only the link itself is read; nothing is fetched, so a site that blocks
// scrapers can't break it.
import { externalHref } from "./externalHref";

const words = (slug) =>
  decodeURIComponent(slug)
    .replace(/[-_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const titleCase = (text) => text.replace(/\b\p{Ll}/gu, (c) => c.toUpperCase());

const SITES = [
  {
    host: /(^|\.)viator\.com$/,
    // /tours/{City}/{Tour-Name}/d{dest}-{code}
    read: (parts) => (parts[0] === "tours" && parts.length >= 3 ? { place: words(parts[1]), title: words(parts[2]) } : null),
  },
  {
    host: /(^|\.)getyourguide\.[a-z.]+$/,
    // /{city}-l{id}/{tour-name}-t{id}
    read: (parts) => {
      const city = parts[0]?.match(/^(.+)-l\d+$/);
      const tour = parts[1]?.match(/^(.+)-t\d+$/);
      if (!city && !tour) return null;
      return { place: city ? titleCase(words(city[1])) : null, title: tour ? titleCase(words(tour[1])) : null };
    },
  },
];

/** { title, place } suggested by `link` (either may be null), or null. */
export function hintsFromLink(link) {
  const href = externalHref(link?.trim());
  if (!href) return null;
  let url;
  try {
    url = new window.URL(href);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const site = SITES.find((s) => s.host.test(host));
  if (!site) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const found = site.read(parts);
  if (!found || (!found.title && !found.place)) return null;
  return { title: found.title || null, place: found.place || null };
}
