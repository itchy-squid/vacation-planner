import { createContext, useContext } from "react";

// The google.maps.Map a MapCanvas has drawn (null until it has), for the
// things placed on it, like the search screen's result markers.
export const MapContext = createContext(null);

export function useMap() {
  return useContext(MapContext);
}
