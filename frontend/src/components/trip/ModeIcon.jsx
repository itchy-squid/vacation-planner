import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBus, faCar, faPersonWalking, faPlane, faRoute, faTrain } from "@fortawesome/free-solid-svg-icons";

const ICONS = { car: faCar, bus: faBus, train: faTrain, walk: faPersonWalking, flight: faPlane };

/** How travel goes (lib/travel.js TRAVEL_MODES); a route glyph for anything else. */
export default function ModeIcon({ mode, style }) {
  return <FontAwesomeIcon icon={ICONS[mode] ?? faRoute} style={style} aria-hidden="true" />;
}
