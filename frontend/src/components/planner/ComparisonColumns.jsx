import { fmtMin } from "../../data/derive";
import { formatMoney } from "../../data/expenses";

// "On the board" beside "Your set", two equal columns.
//
// Both totals come from the same rules (app/derive.py's slack, and
// cost_cents as the whole cost — see data/expenses.js), so this card, the
// Expenses screen and the compare screen are one number rather than three
// that nearly agree.
export default function ComparisonColumns({ board, yours }) {
  return (
    <div style={{ display: "flex", gap: 10 }}>
      <Column
        label="On the board"
        lines={board.lines}
        summary={board.summary}
        total={board.totalCents}
        empty="Nothing in these hours yet"
      />
      <Column
        label="Your set"
        lines={yours.lines}
        summary={yours.summary}
        total={yours.totalCents}
        empty="No stops yet"
        tinted
      />
    </div>
  );
}

function Column({ label, lines, summary, total, empty, tinted = false }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        background: tinted ? "var(--accent-quiet)" : "var(--surface-card)",
        border: `1px solid ${tinted ? "var(--plum-tint-strong)" : "var(--hairline)"}`,
        borderRadius: "var(--radius-lg)",
        padding: "12px 13px",
      }}
    >
      <div className="mono-caption" style={{ color: tinted ? "var(--accent)" : "var(--text-muted)" }}>
        {label}
      </div>
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
        {lines.length === 0 ? (
          <div style={{ font: "400 12px var(--font-sans)", color: "var(--text-muted)" }}>{empty}</div>
        ) : (
          lines.map((line, i) => (
            <div
              key={i}
              style={{
                font: "400 12px var(--font-sans)",
                color: tinted ? "var(--accent-press)" : "var(--text-secondary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {line}
            </div>
          ))
        )}
      </div>
      <div
        className="mono-data-sm"
        style={{ marginTop: 10, color: tinted ? "var(--accent)" : "var(--text-faint)" }}
      >
        {summary}
      </div>
      <div
        className="mono-data-sm"
        style={{ marginTop: 2, color: tinted ? "var(--accent)" : "var(--text-faint)" }}
      >
        {formatMoney(total)} total
      </div>
    </div>
  );
}

export function summariseStops(stopCount, slackMinutes) {
  return `${stopCount} stop${stopCount === 1 ? "" : "s"} · ${fmtMin(slackMinutes)} slack`;
}
