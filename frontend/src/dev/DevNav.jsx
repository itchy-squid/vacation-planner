import { NavLink } from "react-router-dom";
import { usePlannerState } from "../state/PlannerContext";

// Scaffolding only — NOT part of the design. The handoff's seven screens
// aren't fully cross-linked yet (see README "Not yet designed": no
// tab bar or trip-level navigation exists in the spec), so this strip lets
// you jump between them while reviewing. Delete once real navigation
// (or a router that reaches every screen from Trips Home) is designed.
// Trip-scoped screens live under /trips/:tripId/... (see App.jsx), so
// these links point at whichever trip is currently loaded.
export default function DevNav() {
  const { trip } = usePlannerState();
  const base = `/trips/${trip.id}`;
  const LINKS = [
    { to: "/", label: "1 Home" },
    { to: `${base}/board`, label: "2 Board" },
    { to: `${base}/map`, label: "3 Map" },
    { to: `${base}/schedule/5`, label: "4 Schedule" },
    { to: `${base}/compare`, label: "5 Compare" },
    { to: `${base}/itinerary`, label: "7 Final" },
  ];

  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 999,
        display: "flex",
        justifyContent: "center",
        gap: 1,
        background: "#111",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {LINKS.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          style={({ isActive }) => ({
            padding: "6px 12px",
            fontSize: 15,
            color: isActive ? "#8f4478" : "rgba(255,255,255,.6)",
            textDecoration: "none",
          })}
        >
          {l.label}
        </NavLink>
      ))}
    </div>
  );
}
