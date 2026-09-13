import { fmtMin } from "../../data/derive";

// "5h claimed · 4h 15m planned", with a bar weighted planned/claimed.
//
// Slack here means exactly what it means everywhere else in the app now:
// the claimed window minus the stops in it, with no travel-time term (see
// backend/app/derive.py). That's the point of showing it during the build
// — the number a voter sees on the compare screen has to be the number the
// proposer saw while making the thing.
export default function BudgetStrip({ claimedMinutes, plannedMinutes }) {
  const slack = claimedMinutes - plannedMinutes;
  const filled = claimedMinutes > 0 ? Math.min(1, Math.max(0, plannedMinutes / claimedMinutes)) : 0;
  const over = slack < 0;

  return (
    <div
      style={{
        background: "var(--surface-card)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius-lg)",
        padding: "12px 14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 14,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ font: "600 13px var(--font-sans)", color: "var(--text-primary)" }}>
          {fmtMin(claimedMinutes)} claimed · {fmtMin(plannedMinutes)} planned
        </div>
        <div className="mono-data-sm" style={{ marginTop: 3, color: over ? "var(--warn)" : "var(--text-muted)" }}>
          {over ? `${fmtMin(-slack)} over the block` : `${fmtMin(slack)} slack left`}
        </div>
      </div>
      <div
        aria-hidden="true"
        style={{ width: 96, height: 8, borderRadius: 4, background: "var(--surface-sunken)", flex: "none", overflow: "hidden" }}
      >
        <div
          style={{
            width: `${filled * 100}%`,
            height: "100%",
            background: over ? "var(--warn)" : "var(--accent)",
            transition: "width var(--dur-base, .12s) var(--ease-standard, ease-out)",
          }}
        />
      </div>
    </div>
  );
}
