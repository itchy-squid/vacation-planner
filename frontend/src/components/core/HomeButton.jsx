import { useNavigate } from "react-router-dom";

// Persistent way back to Trips Home from every screen. The design handoff
// doesn't specify trip-level navigation yet (see README "Not yet
// designed"), so this small corner affordance fills that gap without
// blocking on a full nav bar design — see DevNav for the dev-only jump
// strip this is NOT a replacement for.
export default function HomeButton({ style, size = 36 }) {
  const navigate = useNavigate();
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
