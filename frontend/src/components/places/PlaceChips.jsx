import { useId, useState } from "react";
import { textFieldStyle } from "../forms/TextField";
import { regionKey } from "../../lib/regions";

/**
 * The trip's places as one-tap chips, plus "+ New place" for one no idea
 * uses yet. `kind` is how a chosen chip looks: "stay" fills solid (one per
 * day), "visit" is dashed and numbered in order (day trips).
 *
 *   names      the places to offer (usePlaceChoices)
 *   chosen     the chosen ones, in order
 *   isDisabled a place that can't be picked here, with why (a tooltip)
 *   onPick     a chip was tapped, or a new place was added
 */
export default function PlaceChips({ label, hint, names, chosen = [], kind = "stay", isDisabled = () => null, onPick }) {
  const labelId = useId();
  const chosenKeys = chosen.map(regionKey);
  const numbered = kind === "visit" && chosen.length > 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {label ? (
        <div id={labelId} style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "2px 8px" }}>
          <span className="mono-caption">{label}</span>
          {hint ? <span style={{ font: "400 11.5px var(--font-sans)", color: "var(--text-secondary)" }}>{hint}</span> : null}
        </div>
      ) : null}
      <div role="group" aria-labelledby={label ? labelId : undefined} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {names.map((name) => {
          const at = chosenKeys.indexOf(regionKey(name));
          const on = at >= 0;
          const why = isDisabled(name);
          return (
            <button
              key={name}
              type="button"
              aria-label={name}
              aria-pressed={on}
              disabled={Boolean(why)}
              title={why || undefined}
              onClick={() => onPick(name)}
              style={chipStyle(kind, on, Boolean(why))}
            >
              {numbered && on ? <span aria-hidden="true" style={numberStyle}>{at + 1}</span> : null}
              {kind === "visit" && !on ? "+ " : ""}
              {name}
            </button>
          );
        })}
        <NewPlace names={names} onAdd={onPick} />
      </div>
    </div>
  );
}

// "+ New place": a place no idea uses yet. A name the trip already has, in
// any case, picks that one rather than adding a second spelling.
function NewPlace({ names, onAdd }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={{ ...chipStyle("stay", false, false), borderStyle: "dashed", color: "var(--accent)" }}>
        + New place
      </button>
    );
  }

  const submit = (e) => {
    e.preventDefault();
    const typed = value.trim();
    if (!typed) return;
    onAdd(names.find((n) => regionKey(n) === regionKey(typed)) ?? typed);
    setValue("");
    setOpen(false);
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", gap: 6, width: "100%" }}>
      <input
        aria-label="New place"
        autoFocus
        value={value}
        maxLength={120}
        onChange={(e) => setValue(e.target.value)}
        placeholder="A town or area, e.g. Yilan"
        style={{ ...textFieldStyle({ size: 13 }), padding: "8px 11px", flex: 1, minWidth: 0 }}
      />
      <button type="submit" disabled={!value.trim()} style={{ ...smallButton, background: "var(--surface-inverse)", color: "#fff", opacity: value.trim() ? 1 : 0.45 }}>
        Add
      </button>
      <button type="button" onClick={() => setOpen(false)} style={{ ...smallButton, border: "1px solid var(--border-strong)" }}>
        Cancel
      </button>
    </form>
  );
}

function chipStyle(kind, on, disabled) {
  const stay = kind === "stay";
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "6px 12px",
    borderRadius: "var(--radius-pill)",
    font: `${on && !stay ? 600 : 500} 12.5px var(--font-sans)`,
    border: on ? (stay ? "1px solid var(--geo)" : "1.5px dashed var(--geo)") : "1px solid var(--border-strong)",
    background: on ? (stay ? "var(--geo)" : "var(--geo-quiet)") : "var(--surface-card)",
    color: on ? (stay ? "#fff" : "var(--geo)") : "var(--text-primary)",
    opacity: disabled ? 0.35 : 1,
  };
}

const numberStyle = {
  display: "inline-grid",
  placeItems: "center",
  width: 16,
  height: 16,
  borderRadius: "50%",
  background: "var(--geo)",
  color: "#fff",
  font: "700 9px var(--font-sans)",
};

const smallButton = {
  flex: "none",
  height: 36,
  padding: "0 12px",
  borderRadius: "var(--radius-md)",
  font: "600 12.5px var(--font-sans)",
};
