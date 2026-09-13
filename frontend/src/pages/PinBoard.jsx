import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import PinCard from "../components/planner/PinCard";
import { usePlannerState } from "../state/PlannerContext";
import TripHeader from "../components/core/TripHeader";
import HeaderIconButton from "../components/core/HeaderIconButton";

// Screen 2 — "collect candidate places." Handoff README screen 2. The
// Board/Map segment switch is gone: the lasso map (pages/LassoMap.jsx) is
// out of the main flow, still routed but no longer linked from here or
// from the bottom nav. Filtering is local UI state only in this pass.
// The "+" opens pages/NewPin.jsx to add a pin from a link.
export default function PinBoard() {
  const navigate = useNavigate();
  const { trip: TRIP, pins, contributors: CONTRIBUTORS } = usePlannerState();
  const [region, setRegion] = useState("All");

  const PINS = useMemo(() => Object.values(pins), [pins]);

  // Region chips are the trip's actual pin regions (from the backend),
  // not a fixed list — alphabetical so the order is stable regardless of
  // pin insertion order or which trip is active.
  const REGIONS = useMemo(() => {
    const set = new Set(PINS.map((p) => p.region).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [PINS]);

  // If the active trip changes (see PlannerContext's OPEN_TRIP) and the
  // selected region filter no longer exists on it, fall back to "All"
  // rather than silently showing zero pins.
  useEffect(() => {
    if (region !== "All" && !REGIONS.includes(region)) setRegion("All");
  }, [REGIONS, region]);

  const filtered = useMemo(() => {
    return region === "All" ? PINS : PINS.filter((p) => p.region === region);
  }, [region, PINS]);

  const columns = [[], []];
  filtered.forEach((pin, i) => columns[i % 2].push(pin));

  const initialFor = (pin) => CONTRIBUTORS.find((c) => c.id === pin.who)?.initial ?? "?";

  return (
    <div className="screen">
      <div className="screen-scroll" style={{ paddingBottom: 24 }}>
        {/* The trip's name lives in the header now, so this screen's own
            heading would only repeat it — what's left is the line that
            says something the header doesn't. */}
        <TripHeader
          right={
            <HeaderIconButton
              glyph="+"
              label="Add pin"
              glyphSize={20}
              onClick={() => navigate(`/trips/${TRIP.id}/new-pin`)}
            />
          }
        />
        <div className="mono-caption" style={{ padding: "6px var(--gutter-text) 12px" }}>Ideation · {PINS.length} pins</div>

        <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "0 var(--gutter-screen) 16px" }}>
          {["All", ...REGIONS].map((r) => (
            <button
              key={r}
              onClick={() => setRegion(r)}
              style={{
                flex: "none",
                padding: "6px 12px",
                borderRadius: 999,
                font: "500 12px var(--font-sans)",
                background: region === r ? "var(--surface-inverse)" : "var(--surface-card)",
                color: region === r ? "#fff" : "var(--text-primary)",
                border: region === r ? "none" : "1px solid var(--border)",
                whiteSpace: "nowrap",
              }}
            >
              {r}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10, padding: "0 var(--gutter-screen)" }}>
          {columns.map((col, ci) => (
            <div key={ci} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
              {col.map((pin) => (
                <PinCard key={pin.id} pin={pin} column={ci} contributorInitial={initialFor(pin)} onOpen={() => navigate(`/trips/${TRIP.id}/edit/${pin.id}?from=board`)} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
