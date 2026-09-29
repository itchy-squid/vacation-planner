// A sheet over the bottom of the screen with a dimmed backdrop; a tap on
// the backdrop (or Escape) closes it. Absolute, not fixed — the same reason
// components/planner/PlanDetailsSheet.jsx gives: fixed would let it spill
// past the app's 430px .app-viewport column on a desktop-width window.
import { useEffect } from "react";

export default function BottomSheet({ label, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "flex-end", zIndex: 50 }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={{
          background: "var(--surface-card)",
          borderRadius: "20px 20px 0 0",
          boxShadow: "var(--shadow-sheet)",
          width: "100%",
          maxHeight: "86%",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 38, height: 4, borderRadius: 99, background: "var(--stone-250)", margin: "10px auto 4px", flex: "none" }} />
        {children}
      </div>
    </div>
  );
}
