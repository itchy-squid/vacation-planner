import { useGuardedNavigate } from "../../state/NavGuard";

// Persistent way back to Trips Home from every screen — a small corner
// affordance on the modal-style flows (EditVisit, NewPin, NewTrip,
// TripSettings) that sit outside the main trip screens. Trip-level
// navigation proper lives in components/core/BottomNav.jsx.
//
// Goes through useGuardedNavigate rather than useNavigate: on those same
// modal-style flows this is one tap from a half-finished edit, so a screen
// holding an unsaved draft (see state/NavGuard.jsx) gets to ask before this
// throws it away. With no guard armed it behaves exactly like navigate().
export default function HomeButton({ style, size = 36 }) {
  const navigate = useGuardedNavigate();
  return (
    <button
      type="button"
      aria-label="Back to Trips home"
      className="tap"
      onClick={() => navigate("/")}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "var(--surface-card)",
        border: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        font: `400 ${Math.round(size * 0.44)}px var(--font-sans)`,
        color: "var(--text-primary)",
        flex: "none",
        ...style,
      }}
    >
      ⌂
    </button>
  );
}
