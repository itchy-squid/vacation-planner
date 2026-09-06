import { BANDS } from "../../data/pins";
import { TRIP_DAYS } from "../../data/trip";

// 8-day x 3-band grid. Cell states: works (teal tint), ruled out (hatch),
// placed (solid plum with a white dot); a user override rings the cell.
// Always explain the hatching with its reason — see "why" chips below the
// grid (design_system readme "Content fundamentals": "Explain restrictions,
// never just assert them").
function cellStyle({ placed, works }) {
  const base = {
    height: 26,
    borderRadius: 5,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    font: "600 11px var(--font-sans)",
    color: "#fff",
    cursor: "pointer",
    transition: "var(--transition-select)",
  };
  if (placed) {
    return { ...base, background: "var(--accent)", border: "1px solid var(--accent)" };
  }
  if (works) {
    return { ...base, background: "var(--teal-tint)", border: "1px solid var(--teal-line)" };
  }
  return {
    ...base,
    background: "var(--pattern-ruled-out)",
    border: "1px solid rgba(27,26,31,.06)",
  };
}

export default function AvailabilityGrid({ pinId, rule, overrides, placedDayBand, onToggle }) {
  const okBase = (day, band) => !rule || (rule.days?.includes(day) && rule.bands?.includes(band));

  let workingCount = 0;
  for (const d of TRIP_DAYS) {
    for (const band of BANDS) {
      const key = `${pinId}|${d.n}-${band}`;
      const works = overrides[key] ? !okBase(d.n, band) : okBase(d.n, band);
      if (works) workingCount += 1;
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span className="mono-caption">When this one can happen</span>
        <span className="mono-data-sm" style={{ color: "var(--accent)" }}>
          {workingCount} OF {TRIP_DAYS.length * BANDS.length} BLOCKS
        </span>
      </div>

      <div style={{ marginTop: 11, display: "flex", gap: 4 }}>
        <div style={{ width: 30, flex: "none" }} />
        {TRIP_DAYS.map((d) => (
          <div key={d.n} style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
            <div className="mono-data-sm" style={{ color: "var(--text-faint)" }}>{d.dow[0]}</div>
            <div style={{ font: "600 10px var(--font-sans)", color: "var(--text-secondary)" }}>{d.n}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 5, display: "flex", flexDirection: "column", gap: 4 }}>
        {BANDS.map((band) => (
          <div key={band} style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <div className="mono-data-sm" style={{ width: 30, flex: "none", color: "var(--text-faint)" }}>{band}</div>
            {TRIP_DAYS.map((d) => {
              const key = `${pinId}|${d.n}-${band}`;
              const overridden = Boolean(overrides[key]);
              const works = overridden ? !okBase(d.n, band) : okBase(d.n, band);
              const placed = placedDayBand === `${d.n}-${band}` && works;
              return (
                <div
                  key={key}
                  onClick={() => onToggle(d.n, band)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    boxShadow: overridden ? "0 0 0 1.5px rgba(143,68,120,.55)" : "none",
                    borderRadius: 5,
                  }}
                >
                  <div style={cellStyle({ placed, works })}>{placed ? "•" : ""}</div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 10 }}>
        <Legend swatch="var(--accent)" label="placed" />
        <Legend swatch="var(--teal-tint)" border="var(--teal-line)" label="works" />
        <Legend swatch="var(--pattern-ruled-out)" label="ruled out" />
      </div>

      {rule?.why?.length ? (
        <div style={{ marginTop: 11, paddingTop: 10, borderTop: "1px solid var(--hairline)", display: "flex", flexWrap: "wrap", gap: 6 }}>
          {rule.why.map((w) => (
            <div key={w} style={{ padding: "5px 9px", borderRadius: 7, background: "var(--surface-page)", font: "400 10.5px var(--font-sans)", color: "var(--text-secondary)" }}>
              {w}
            </div>
          ))}
        </div>
      ) : null}

      <div className="mono-caption" style={{ marginTop: 9, fontFamily: "var(--font-sans)", textTransform: "none", letterSpacing: 0, lineHeight: 1.5, color: "var(--text-muted)" }}>
        Tap a square to override. Only squares that work show up as options when the group compares sets.
      </div>
    </div>
  );
}

function Legend({ swatch, border, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <div style={{ width: 11, height: 11, borderRadius: 3, background: swatch, border: border ? `1px solid ${border}` : undefined }} />
      <span style={{ font: "400 9.5px var(--font-sans)", color: "var(--text-secondary)" }}>{label}</span>
    </div>
  );
}
