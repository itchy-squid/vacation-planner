import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePlannerState } from "../../state/PlannerContext";

// Single hamburger entry point for the trip's three main screens (Board,
// Map, Schedule — pages/PinBoard.jsx, pages/LassoMap.jsx,
// pages/DaySchedule.jsx), replacing the HomeButton+SettingsButton pair
// that used to sit side by side there. Two circular buttons ate into
// header space that's tight on the Board/Schedule headers and genuinely
// scarce on the Map's floating control row (search bar + locate button
// share that line) — collapsing them into one menu button gets that
// space back without losing either destination.
//
// Screens that only ever showed HomeButton alone (EditVisit, NewPin,
// NewTrip, TripSettings — each already paired with an explicit "Cancel")
// are untouched: there's nothing to collapse when there's only one
// button, and those are modal-style flows rather than main trip screens.
export default function NavMenu({ style, size = 36 }) {
  const navigate = useNavigate();
  const { trip } = usePlannerState();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function go(path) {
    setOpen(false);
    navigate(path);
  }

  return (
    <div ref={rootRef} style={{ position: "relative", flex: "none" }}>
      <button
        type="button"
        aria-label="Menu"
        aria-haspopup="true"
        aria-expanded={open}
        className="tap"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: "var(--surface-card)",
          border: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          font: `400 ${Math.round(size * 0.46)}px var(--font-sans)`,
          color: "var(--text-primary)",
          flex: "none",
          ...style,
        }}
      >
        ☰
      </button>

      {open ? (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            minWidth: 172,
            background: "var(--surface-card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-select)",
            padding: 4,
            zIndex: 20,
          }}
        >
          <MenuItem label="Trips home" onClick={() => go("/")} />
          <MenuItem label="Trip settings" onClick={() => go(`/trips/${trip.id}/trip-settings`)} />
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({ label, onClick }) {
  return (
    <button
      type="button"
      role="menuitem"
      className="tap"
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "9px 10px",
        borderRadius: "var(--radius-sm)",
        font: "500 13px var(--font-sans)",
        color: "var(--text-primary)",
      }}
    >
      {label}
    </button>
  );
}
