// A short message over the bottom of the screen, with an optional action
// ("Undo"). It goes away by itself; `onDone` is called when it does, or
// straight after the action.
import { useEffect } from "react";

const SHOWN_MS = 3000;
const SHOWN_WITH_ACTION_MS = 6000;

export default function Toast({ message, actionLabel, onAction, onDone }) {
  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(onDone, onAction ? SHOWN_WITH_ACTION_MS : SHOWN_MS);
    return () => clearTimeout(timer);
  }, [message, onAction, onDone]);

  if (!message) return null;
  return (
    <div
      role="status"
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        bottom: 16,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "11px 14px",
        borderRadius: "var(--radius-lg)",
        background: "var(--surface-inverse)",
        color: "var(--text-on-dark)",
        font: "500 13px/1.4 var(--font-sans)",
        boxShadow: "var(--shadow-raised)",
      }}
    >
      <span style={{ flex: 1 }}>{message}</span>
      {onAction ? (
        <button
          type="button"
          onClick={() => {
            onAction();
            onDone();
          }}
          style={{ flex: "none", font: "700 13px var(--font-sans)", color: "var(--accent-on-dark)" }}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
