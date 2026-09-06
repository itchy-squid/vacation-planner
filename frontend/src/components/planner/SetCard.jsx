import PhotoPlaceholder from "../core/PhotoPlaceholder";
import MetricTile from "./MetricTile";

// Only the selected card expands. Selection border/shadow only — never a
// background change. See handoff README screen 5 "Set cards".
export default function SetCard({
  color,
  name,
  sub,
  isLeading,
  votes,
  cost,
  moving,
  slack,
  slackColor,
  selected,
  onSelect,
  stops,
  onEditStop,
  voted,
  onVote,
  onLock,
  isOwner,
}) {
  return (
    <div
      style={{
        borderRadius: "var(--radius-2xl)",
        border: selected ? `1.5px solid ${color}` : "1px solid var(--border)",
        boxShadow: selected ? "var(--shadow-select)" : "none",
        background: "var(--surface-card)",
        transition: "var(--transition-select)",
      }}
    >
      <div className="tap" onClick={onSelect} style={{ padding: "11px 12px 10px", cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 10, height: 10, borderRadius: 3, background: color, flex: "none" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: "600 13.5px var(--font-sans)", color: "var(--text-primary)" }}>{name}</div>
            <div className="mono-data-sm" style={{ color: "var(--text-secondary)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {sub}
            </div>
          </div>
          {isLeading ? (
            <span style={{ font: "600 9px var(--font-mono)", background: "var(--accent)", color: "#fff", padding: "3px 6px", borderRadius: 4, flex: "none" }}>
              LEADING
            </span>
          ) : null}
          <div style={{ textAlign: "center", flex: "none", minWidth: 34 }}>
            <div style={{ font: "600 15px var(--font-sans)", color: "var(--stone-700)" }}>{votes}</div>
            <div style={{ font: "500 8px var(--font-mono)", color: "var(--text-muted)" }}>VOTES</div>
          </div>
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
          <MetricTile value={`$${cost}`} label="each" />
          <MetricTile value={fmtMin(moving)} label="moving" />
          <MetricTile value={fmtMin(slack)} label="slack" valueColor={slackColor} />
        </div>
      </div>

      {selected ? (
        <div style={{ padding: "0 12px 12px" }}>
          <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 7 }}>
            {stops.map((s) => (
              <div
                key={s.id}
                className="tap"
                onClick={() => onEditStop(s.id)}
                style={{ display: "flex", gap: 9, alignItems: "center", background: "var(--surface-inset)", border: "1px solid rgba(27,26,31,.07)", borderRadius: "var(--radius-md)", padding: "8px 9px", cursor: "pointer" }}
              >
                <PhotoPlaceholder height={34} radius={8} label="" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: "600 11.5px var(--font-sans)", lineHeight: 1.25, color: "var(--text-primary)" }}>{s.title}</div>
                  <div className="mono-data-sm" style={{ color: "var(--text-muted)", marginTop: 2 }}>{s.meta}</div>
                </div>
                <span style={{ font: "500 10px var(--font-sans)", color: "var(--accent)", flex: "none" }}>Edit</span>
              </div>
            ))}
            {stops.length === 0 ? (
              <div style={{ font: "400 11px var(--font-sans)", color: "var(--text-muted)" }}>Add pins from the pool below.</div>
            ) : null}
          </div>

          <div style={{ marginTop: 11, display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={onVote}
              style={{
                flex: 1,
                height: 40,
                borderRadius: "var(--radius-lg)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                font: "600 13px var(--font-sans)",
                background: voted ? color : "var(--surface-card)",
                color: voted ? "#fff" : "var(--text-primary)",
                border: voted ? "none" : "1px solid var(--border-strong)",
                transition: "background var(--dur-fast) var(--ease-standard)",
              }}
            >
              {voted ? "Voted ✓" : "Vote for this set"}
            </button>
            {isOwner ? (
              <button
                type="button"
                onClick={onLock}
                style={{ flex: 1, height: 40, borderRadius: "var(--radius-lg)", background: "var(--surface-inverse)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", font: "600 13px var(--font-sans)" }}
              >
                Lock this set
              </button>
            ) : null}
          </div>
          {!isOwner ? (
            <div style={{ marginTop: 8, font: "400 10.5px var(--font-sans)", color: "var(--text-muted)" }}>
              Only Mei (owner) can lock. Everyone else can vote and comment.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function fmtMin(m) {
  const s = m < 0 ? "−" : "";
  const a = Math.abs(m);
  const h = Math.floor(a / 60);
  const mm = a % 60;
  return h ? `${s}${h}h${mm ? ` ${mm}m` : ""}` : `${s}${mm}m`;
}
