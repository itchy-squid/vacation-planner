import { useEffect, useState } from "react";
import Stepper from "./Stepper";

// Which day of the trip something is on: − / + for a day either way, and
// the day number itself is a small text box you can type into, so Day 20
// of a long trip is one edit away instead of a long scroll through a row
// of day chips (components/planner/PlanDetailsSheet.jsx used to have one).
//
//   value     the current day, 1-based
//   count     how many days the trip has
//   detail    the day's date ("Mon, Oct 12"); "" for a trip without dates
//   onChange  (day) -> called once per change, never with the current day
//
// Typing only commits on Enter or when the box loses focus — committing
// per keystroke would move the item to Day 2 on the way to typing "20".
// Escape puts the current day back. A number outside 1..count isn't
// committed; the box snaps back and says what range it takes.
export default function DayStepper({ label = "Day", value, count, detail = "", onChange, disabled = false }) {
  const [draft, setDraft] = useState(String(value));
  const [hint, setHint] = useState("");

  // Follow the value from outside: a step, a save that was reverted
  // (slot taken), or a different item entirely.
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function go(day) {
    setHint("");
    if (day !== value) onChange(day);
  }

  function commitDraft() {
    const day = Number(draft.trim());
    if (!Number.isInteger(day) || day < 1 || day > count) {
      setDraft(String(value));
      // An emptied box is "never mind", not a mistake worth a message.
      setHint(draft.trim() === "" ? "" : `Pick a day from 1 to ${count}.`);
      return;
    }
    setDraft(String(day));
    go(day);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur(); // commits via onBlur, so there's one commit path
    } else if (e.key === "Escape") {
      // Don't let Escape reach a sheet that closes on it; it only means
      // "undo my typing" here.
      e.stopPropagation();
      setDraft(String(value));
      setHint("");
      e.currentTarget.blur();
    }
  }

  return (
    <div>
      <Stepper
        label={label}
        onDown={() => go(value - 1)}
        onUp={() => go(value + 1)}
        disabled={disabled}
        downDisabled={value <= 1}
        upDisabled={value >= count}
        downLabel="Earlier day"
        upLabel="Later day"
      >
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, maxWidth: "100%" }}>
          Day
          <input
            type="text"
            inputMode="numeric"
            aria-label="Day number"
            value={draft}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 3))}
            onFocus={(e) => e.target.select()}
            onBlur={commitDraft}
            onKeyDown={handleKeyDown}
            style={{
              width: 36,
              height: 30,
              textAlign: "center",
              font: "600 14px var(--font-sans)",
              color: "var(--text-primary)",
              background: "var(--surface-page)",
              border: "1px solid var(--border)",
              borderRadius: 8,
            }}
          />
          <span style={{ font: "400 11px var(--font-sans)", color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            of {count}
            {detail ? ` · ${detail}` : ""}
          </span>
        </span>
      </Stepper>
      {hint ? (
        <div role="alert" style={{ marginTop: 4, font: "500 11px var(--font-sans)", color: "var(--warn, #a15c1a)" }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}
