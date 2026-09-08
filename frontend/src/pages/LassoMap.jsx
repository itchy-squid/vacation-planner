import { useState } from "react";
import { useNavigate } from "react-router-dom";
import MapPlaceholder from "../components/planner/MapPlaceholder";
import PhotoPlaceholder from "../components/core/PhotoPlaceholder";
import Button from "../components/core/Button";
import { usePlannerState } from "../state/PlannerContext";
import NavMenu from "../components/core/NavMenu";

// Screen 3 — "group pins by geography and seed day groups." Handoff README
// screen 3. Cluster positions here are a schematic layout for the
// placeholder canvas, not real geocoding — see design_system readme "Map
// provider" for the Google Maps clustering plan this replaces.
const CLUSTERS = [
  { region: "Xiaoliuqiu", cx: 190, cy: 340, size: 56, active: true },
  { region: "Taipei", cx: 110, cy: 130, size: 48, active: false },
  { region: "Hualien", cx: 290, cy: 170, size: 46, active: false },
  { region: "Tainan", cx: 90, cy: 460, size: 44, active: false },
];
const OUTLIER = { cx: 320, cy: 520, count: 2 };

export default function LassoMap() {
  const navigate = useNavigate();
  const { pins, trip } = usePlannerState();
  const pinsByRegion = (region) => Object.values(pins).filter((p) => p.region === region);
  const [lassoedRegion, setLassoedRegion] = useState("Xiaoliuqiu");
  const lassoedPins = pinsByRegion(lassoedRegion);
  const activeCluster = CLUSTERS.find((c) => c.region === lassoedRegion) ?? CLUSTERS[0];

  return (
    <div className="screen">
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <MapPlaceholder height="100%">
          <div style={{ position: "absolute", top: 58, left: 16, right: 16, display: "flex", gap: 8, zIndex: 5 }}>
            <NavMenu size={48} style={{ borderRadius: "var(--radius-lg)", background: "var(--surface-card)", border: "1px solid var(--border-strong)", boxShadow: "var(--shadow-select)" }} />
            <div style={{ flex: 1, height: 48, borderRadius: "var(--radius-lg)", background: "var(--surface-card)", border: "1px solid var(--border-strong)", boxShadow: "var(--shadow-select)", display: "flex", alignItems: "center", padding: "0 14px", font: "400 16px var(--font-sans)", color: "var(--text-secondary)" }}>
              Search a place to pin…
            </div>
            <button style={{ width: 48, height: 48, borderRadius: "var(--radius-lg)", background: "var(--surface-inverse)", color: "#fff", flex: "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, boxShadow: "var(--shadow-select)" }}>◌</button>
          </div>

          {/* Lasso: a dashed blobby shape around the selected cluster */}
          <div
            style={{
              position: "absolute",
              left: activeCluster.cx - 95,
              top: activeCluster.cy - 85,
              width: 190,
              height: 170,
              borderRadius: "50% 46% 52% 48%",
              border: "2px dashed var(--accent)",
              background: "rgba(143,68,120,.09)",
              zIndex: 2,
            }}
          />

          {CLUSTERS.map((c) => {
            const count = pinsByRegion(c.region).length;
            const isActive = c.region === lassoedRegion;
            return (
              <div
                key={c.region}
                className="tap"
                onClick={() => setLassoedRegion(c.region)}
                style={{
                  position: "absolute",
                  left: c.cx,
                  top: c.cy,
                  transform: "translate(-50%, -50%)",
                  width: isActive ? 56 : c.size,
                  height: isActive ? 56 : c.size,
                  borderRadius: "50%",
                  background: isActive ? "var(--accent)" : "var(--geo)",
                  color: "#fff",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: isActive ? "var(--shadow-cluster)" : "var(--shadow-cluster-geo)",
                  zIndex: 4,
                  cursor: "pointer",
                }}
              >
                <span style={{ font: "600 17px var(--font-sans)" }}>{count}</span>
                <span className="mono-data-sm" style={{ color: "rgba(255,255,255,.85)", fontSize: 8 }}>{c.region}</span>
              </div>
            );
          })}

          <div
            style={{
              position: "absolute",
              left: OUTLIER.cx,
              top: OUTLIER.cy,
              transform: "translate(-50%, -50%)",
              width: 34,
              height: 34,
              borderRadius: "50%",
              background: "#fff",
              border: "2px solid rgba(27,26,31,.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              font: "600 12px var(--font-sans)",
              color: "var(--text-secondary)",
              zIndex: 4,
            }}
          >
            {OUTLIER.count}
          </div>
        </MapPlaceholder>
      </div>

      <div style={{ background: "var(--surface-card)", borderRadius: "20px 20px 0 0", boxShadow: "var(--shadow-sheet)", padding: "12px 18px 44px", flex: "none" }}>
        <div style={{ width: 38, height: 4, borderRadius: 99, background: "var(--stone-250)", margin: "0 auto 12px" }} />
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <div>
            <div className="mono-caption">Lassoed</div>
            <div className="serif-place" style={{ fontSize: 21, marginTop: 2, color: "var(--text-primary)" }}>{lassoedRegion} · {lassoedPins.length} pins</div>
          </div>
          <button style={{ font: "500 12px var(--font-sans)", color: "var(--accent)" }}>edit shape</button>
        </div>

        <div style={{ display: "flex", gap: 8, overflowX: "auto", marginTop: 12 }}>
          {lassoedPins.map((p) => (
            <PhotoPlaceholder key={p.id} height={104} label="" style={{ width: 104, flex: "none", borderRadius: "var(--radius-md)" }} />
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14 }}>
          <div style={{ flex: 1 }}>
            <Button variant="primary" onClick={() => navigate(`/trips/${trip.id}/schedule/5`)}>Make these days 5–6</Button>
          </div>
          <button style={{ width: 46, height: 46, borderRadius: "var(--radius-lg)", border: "1px solid var(--border-strong)", background: "var(--surface-card)", flex: "none", fontSize: 18 }}>⋯</button>
        </div>
        <div style={{ marginTop: 9, font: "400 11px var(--font-sans)", color: "var(--text-muted)" }}>
          Regions become day groups. You still place each pin by hand.
        </div>
      </div>
    </div>
  );
}
