import { useEffect, useRef, useState } from "react";
import { searchPlaces } from "../../lib/places";

const DEBOUNCE_MS = 450;
export const MIN_QUERY_LENGTH = 3;

/**
 * The search on the new-pin screen, kept by pages/NewPin.jsx rather than
 * the search step itself, so going on to the details form and back keeps
 * the query, the results and the selection (and doesn't pay for the same
 * search twice).
 *
 * `viewRef.current` is set by the search step's map to
 * () => ({ bounds, center }): results prefer places inside the bounds, and
 * distances are measured from the centre.
 *
 * Finding an existing idea's place (components/newpin/FindOnGoogle.jsx)
 * starts with `initialQuery` (the idea's title) and a fixed `bias`, the
 * idea's region ({ south, west, north, east }), which then also sets where
 * distances are measured from.
 *
 *   status: "idle"      too short to search
 *           "searching"
 *           "done"      results holds what was found (possibly nothing)
 *           "error"     Places couldn't be reached, or refused the key
 */
export function usePlaceSearch({ initialQuery = "", bias = null } = {}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState([]);
  const [origin, setOrigin] = useState(null);
  const [status, setStatus] = useState("idle");
  const [selectedId, setSelectedId] = useState(null);
  const viewRef = useRef(null);
  const requestRef = useRef(0);
  // Fixed for the life of the search.
  const biasRef = useRef(bias);

  useEffect(() => {
    const input = query.trim();
    const request = ++requestRef.current;
    if (input.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setSelectedId(null);
      setStatus("idle");
      return undefined;
    }
    const timer = setTimeout(async () => {
      setStatus("searching");
      const fixed = biasRef.current;
      const view = fixed ? null : viewRef.current?.() ?? null;
      try {
        const found = await searchPlaces(input, { bias: fixed ?? view?.bounds });
        // A slower answer to an older query mustn't replace a newer one.
        if (request !== requestRef.current) return;
        setResults(found);
        setOrigin(fixed ? { lat: (fixed.south + fixed.north) / 2, lng: (fixed.west + fixed.east) / 2 } : view?.center ?? null);
        setSelectedId(null);
        setStatus("done");
      } catch {
        if (request !== requestRef.current) return;
        setResults([]);
        setStatus("error");
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  return { query, setQuery, results, origin, status, selectedId, setSelectedId, viewRef };
}
