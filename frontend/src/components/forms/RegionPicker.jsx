import { useId } from "react";
import TextField from "./TextField";

/**
 * A region for an idea: the trip's regions as one-tap chips, and a field
 * for any other. Used when adding by hand (components/newpin/
 * ByHandForm.jsx) and on the idea's own screen (pages/EditVisit.jsx).
 *
 *   value        the region name
 *   chosenChip   which chip `value` matches (useRegionPreview), or null
 *   tag          something to show at the end of the label row, like a
 *                "From the link" tag
 *   readOnly     shows the region without letting it change
 */
export default function RegionPicker({ knownRegions, value, chosenChip, onChange, tag = null, readOnly = false }) {
  const labelId = useId();

  if (readOnly) {
    return (
      <div>
        <span className="mono-caption">Region</span>
        <div style={{ marginTop: 6, font: "500 13.5px var(--font-sans)", color: value ? "var(--text-primary)" : "var(--text-muted)" }}>{value || "No region"}</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="mono-caption" id={labelId}>
          Region
        </span>
        {tag}
      </div>
      {knownRegions.length ? (
        <div role="group" aria-labelledby={labelId} style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          {knownRegions.map((r) => {
            const on = chosenChip === r;
            return (
              <button
                key={r}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? "" : r)}
                style={{
                  padding: "6px 12px",
                  borderRadius: "var(--radius-pill)",
                  font: "500 12.5px var(--font-sans)",
                  border: `1px solid ${on ? "var(--geo)" : "var(--border-strong)"}`,
                  background: on ? "var(--geo)" : "var(--surface-card)",
                  color: on ? "#fff" : "var(--text-primary)",
                }}
              >
                {r}
              </button>
            );
          })}
        </div>
      ) : null}
      <div style={{ marginTop: 8 }}>
        <TextField
          aria-label={knownRegions.length ? "Another region" : "Region"}
          value={chosenChip ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={knownRegions.length ? "Another region, e.g. Akumal" : "e.g. Cozumel"}
        />
      </div>
    </div>
  );
}
