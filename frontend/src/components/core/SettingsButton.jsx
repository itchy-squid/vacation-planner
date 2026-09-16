import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGear } from "@fortawesome/free-solid-svg-icons";
import { usePlannerState } from "../../state/PlannerContext";
import { useGuardedNavigate } from "../../state/NavGuard";
import HeaderIconButton from "./HeaderIconButton";

// The gear in the top-right corner of every trip screen — trip settings
// (name/regions/dates, see pages/TripSettings.jsx). Trip settings is a
// trip-scoped route (/trips/:tripId/trip-settings — see App.jsx), so this
// needs the active trip's id, not just a fixed path.
//
// Chromeless: no border, no fill, just the glyph, so a header row reads as
// its content (the trip's name) rather than as a row of buttons. The touch
// target is a full 44px square all the same — see HeaderIconButton, which
// is where that separation of "how big it looks" from "how big it is to a
// thumb" lives.
export default function SettingsButton({ style, size = 36 }) {
  const navigate = useGuardedNavigate();
  const { trip } = usePlannerState();
  if (!trip) return null;
  const glyphSize = Math.round(size * 0.5);
  return (
    <HeaderIconButton
      glyph={<FontAwesomeIcon icon={faGear} style={{ width: glyphSize, height: glyphSize }} />}
      label="Trip settings"
      onClick={() => navigate(`/trips/${trip.id}/trip-settings`)}
      glyphSize={glyphSize}
      style={style}
    />
  );
}
