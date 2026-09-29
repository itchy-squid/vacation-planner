import { useCallback, useMemo } from "react";
import ClusterBubbles from "./ClusterBubbles";
import PinDots from "./PinDots";
import RegionAreas from "./RegionAreas";
import { layoutIdeas } from "./ideaLayout";
import { useMap } from "./mapContext";
import { useMapZoom } from "./useMapZoom";

/**
 * The Map tab's ideas on the surrounding MapCanvas, laid out for the
 * current zoom (see ideaLayout.js): plum dots for exact spots, plum bubbles
 * where spots would overlap, and a teal badge per region for ideas with no
 * exact spot, unless it would cover a bubble, which then counts them too.
 * Every marker hides Google's labels under it.
 *
 *   pins                 ideas with an exact spot
 *   regions              [{ key, name, lat, lng, count }] region badges
 *   highlightedId        the selected idea
 *   selectedRegionKey    the selected region
 *   onTapPin(pin), onTapRegion(region)
 *   onTapStack(cluster)  a bubble whose ideas share one spot, so zooming
 *                        can't split it: list them instead
 *   fitPadding           room to keep clear when zooming to a bubble
 */
export default function IdeaMarkers({ pins, regions, highlightedId, selectedRegionKey, onTapPin, onTapRegion, onTapStack, fitPadding }) {
  const map = useMap();
  const view = useMapZoom();
  const { dots, clusters, badges, compactKeys } = useMemo(
    () => layoutIdeas({ pins, regions, highlightedId, selectedRegionKey, view }),
    [pins, regions, highlightedId, selectedRegionKey, view]
  );

  const tapCluster = useCallback(
    (cluster) => {
      if (cluster.splittable) map?.fitBounds(cluster.bounds, fitPadding);
      else onTapStack(cluster);
    },
    [map, fitPadding, onTapStack]
  );

  return (
    <>
      <RegionAreas regions={badges} showArea={false} compactKeys={compactKeys} selectedKey={selectedRegionKey} onTap={onTapRegion} />
      <ClusterBubbles clusters={clusters} onTap={tapCluster} />
      <PinDots pins={dots} highlightedId={highlightedId} hidesLabels onTap={onTapPin} />
    </>
  );
}
