// How big the Map tab's markers are, in pixels: the elements drawn by
// PinDots, ClusterBubbles and RegionAreas use these, and IdeaMarkers uses
// them to work out what would overlap.

export const DOT_SIZE = 14;
export const HIGHLIGHTED_DOT_SIZE = 20;
export const PHOTO_MARKER_SIZE = 46;

/** A bubble's diameter: a little bigger as the count grows. */
export function bubbleSize(count) {
  if (count < 5) return 32;
  return count < 10 ? 38 : 44;
}

/**
 * About how much room a region badge takes. From its CSS: 11px text at
 * roughly 6.2px a letter, plus the count, gap, padding and border. The
 * compact badge is just the count.
 */
export function badgeSize(name, compact = false) {
  return compact ? { width: 24, height: 22 } : { width: 42 + name.length * 6.2, height: 28 };
}
