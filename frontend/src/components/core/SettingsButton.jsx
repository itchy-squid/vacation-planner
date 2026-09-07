import { useNavigate } from "react-router-dom";
import { usePlannerState } from "../../state/PlannerContext";

// Persistent way to reach trip settings (name/regions/dates — see
// pages/TripSettings.jsx) from any of the trip's main screens. Mirrors
// HomeButton's shape/API since the two are meant to sit side by side.
// Trip settings is a trip-scoped route (/trips/:tripId/trip-settings —
// see App.jsx), so this needs the active trip's id, not just "/".
export default function SettingsButton({ style, size = 36 }) {
  const navigate = useNavigate();
  const { trip } = usePlannerState();
  return (
    <button
      type="button"
      aria-label="Trip settings"
      className="tap"
      onClick={() => navigate(`/trips/${trip.id}/trip-settings`)}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "var(--surface-card)",
        border: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        font: `400 ${Math.round(size * 0.5)}px var(--font-sans)`,
        color: "var(--text-primary)",
        flex: "none",
        ...style,
      }}
    >
      ⚙
    </button>
  );
}
