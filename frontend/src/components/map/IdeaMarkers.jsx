import { useCallback, useMemo } from "react";
import ClusterBubbles from "./ClusterBubbles";
import PinDots from "./PinDots";
import RegionAreas from "./RegionAreas";
import { cameraFor, expansionZoom, layoutIdeas } from "./ideaLayout";
import { useMap } from "./mapContext";
import { useMapZoom } from "./useMapZoom";

/**
 * The Map tab's ideas on the surrounding MapCanvas, laid out for the
 * current zoom (see ideaLayout.js): plum dots for exact spots, plum bubbles
 * where spots would overlap, and a teal badge per region for ideas with no
 * exact spot, which stays separate from any bubble beside it.
 * Every marker hides Google's labels under it.
 *
 *   pins                 ideas with an exact spot
 *   regions              [{ key, name, lat, lng, count }] region badges
 *   highlightedId        the selected idea
 *   selectedRegionKey    the selected region
 *   onTapPin(pin), onTapRegion(region)
 *   onTapStack(cluster)  a bubble whose ideas share one spot, so zooming
 *                        can't split it: list them instead
 *   fitPadding           map edges covered by other things (the floating
 *                        header), kept clear when centring on a bubble
 */
export default function IdeaMarkers({ pins, regions, highlightedId, selectedRegionKey, onTapPin, onTapRegion, onTapStack, fitPadding }) {
  const map = useMap();
  const view = useMapZoom();
  const input = useMemo(() => ({ pins, regions, highlightedId, view }), [pins, regions, highlightedId, view]);
  const { dots, clusters, compactKeys } = useMemo(() => layoutIdeas(input), [input]);

  // Just far enough in for the bubble to break up, centred on it.
  const tapCluster = useCallback(
    (cluster) => {
      const zoom = expansionZoom(cluster, input);
      if (zoom == null) {
        onTapStack(cluster);
        return;
      }
      const { center } = cameraFor(cluster, zoom, fitPadding, input.view.toWorld);
      map?.setCenter(center);
      map?.setZoom(zoom);
    },
    [map, input, fitPadding, onTapStack]
  );

  return (
    <>
      <RegionAreas regions={regions} showArea={false} compactKeys={compactKeys} selectedKey={selectedRegionKey} onTap={onTapRegion} />
      <ClusterBubbles clusters={clusters} onTap={tapCluster} />
      <PinDots pins={dots} highlightedId={highlightedId} hidesLabels onTap={onTapPin} />
    </>
  );
}
