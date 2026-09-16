import { useMemo, useState } from "react";
import TripHeader from "../components/core/TripHeader";
import { usePlannerState, useCurrentUser } from "../state/PlannerContext";
import { buildExpenses, formatMoney } from "../data/expenses";
import { getTripDays } from "../data/trip";
import { clockLabel } from "../lib/planTime";

// Screen 8 — "what does the planned trip cost, and what's my part of it."
// Handoff README screen 2, built against the real Plan/PlanItem model.
//
// Everything here is derived from `plans`, which the app has already
// fetched for the calendar — there is no expenses endpoint and no stored
// total (see data/expenses.js for the arithmetic, and the feature spec's
// decision 3 for why per-head is a division rather than a column).
//
// Two things the handoff drew that aren't here. The category bar and its
// legend are gone: pins carry free-form `tags` and travel items carry
// none, so there is no "beach / shows / dining" to weight a bar by, and
// inventing one would be a chart of nothing (decision 8). And the currency
// is a hardcoded USD — the schema has nowhere to put a trip's currency
// yet, and a fixed label at least stops the bare "$" from implying an
// answer the app doesn't have (decision 10).
const CURRENCY = "USD";

export default function Expenses() {
  const state = usePlannerState();
  const viewer = useCurrentUser();
  const { trip, plans, contributors } = state;

  const [showFree, setShowFree] = useState(false);

  const expenses = useMemo(
    () => buildExpenses(plans, { trip, contributors, viewerId: viewer.id }),
    [plans, trip, contributors, viewer.id]
  );
  const dayCount = useMemo(() => getTripDays(trip.startDate, trip.endDate).length, [trip.startDate, trip.endDate]);
  const travellerCount = trip.travellerCount || contributors.length || 1;

  return (
    <div className="screen">
      <div className="screen-scroll" style={{ paddingBottom: 90 }}>
        <TripHeader
          right={
            <span className="mono-data-sm" style={{ color: "var(--text-secondary)", padding: "0 4px" }}>
              {CURRENCY}
            </span>
          }
        />

        <div style={{ padding: "6px var(--gutter-text) 0" }}>
          <div className="mono-caption">
            Expenses · {dayCount} {dayCount === 1 ? "day" : "days"} · {travellerCount}{" "}
            {travellerCount === 1 ? "traveller" : "travellers"}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px var(--gutter-screen) 0" }}>
          <SummaryCard yourShareCents={expenses.yourShareCents} tripTotalCents={expenses.tripTotalCents} />

          {expenses.days.map((day) => (
            <DayCard key={day.dayIndex} label={day.label} rows={day.rows} />
          ))}

          {expenses.days.length === 0 && (
            <div
              style={{
                borderRadius: "var(--radius-lg)",
                border: "1.5px dashed var(--border-strong)",
                padding: "15px 16px",
                font: "400 12.5px var(--font-sans)",
                color: "var(--text-secondary)",
              }}
            >
              Nothing on the calendar costs anything yet. Add a cost to a visit and it shows up here.
            </div>
          )}

          {expenses.freeRows.length > 0 && (
            <FreeItems rows={expenses.freeRows} expanded={showFree} onToggle={() => setShowFree((v) => !v)} />
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ yourShareCents, tripTotalCents }) {
  return (
    <div
      style={{
        background: "var(--surface-card)",
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--hairline)",
        padding: "16px 18px",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 14,
      }}
    >
      <div>
        <div className="mono-caption">Your share</div>
        <div className="serif-place" style={{ fontSize: 34, lineHeight: 1, marginTop: 6, color: "var(--text-primary)" }}>
          {formatMoney(yourShareCents)}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div className="mono-caption">Trip total</div>
        <div className="serif-place" style={{ fontSize: 22, lineHeight: 1, marginTop: 6, color: "var(--stone-700)" }}>
          {formatMoney(tripTotalCents)}
        </div>
      </div>
    </div>
  );
}

function DayCard({ label, rows }) {
  return (
    <div
      style={{
        background: "var(--surface-card)",
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--hairline)",
        padding: "14px 18px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div className="serif-place" style={{ fontSize: 17, color: "var(--text-primary)" }}>
        {label}
      </div>
      {rows.map((row) => (
        <ExpenseRow key={row.key} row={row} />
      ))}
    </div>
  );
}

function ExpenseRow({ row }) {
  const meta = [
    row.startMinuteOfDay != null ? clockLabel(row.startMinuteOfDay) : null,
    `${formatMoney(row.perHeadCents)} × ${row.headcount}`,
    row.headsLabel || null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 12 }}>
      {/* Teal for the trip's money, plum for money that's the viewer's own
          share — the same two meanings those hues carry everywhere else in
          the app (design_system readme, "Colour"). */}
      <div
        aria-hidden="true"
        style={{ width: 3, borderRadius: 2, flex: "none", background: row.viewerIsHead ? "var(--accent)" : "var(--geo)" }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: "600 14px var(--font-sans)", color: "var(--text-primary)" }}>{row.title}</div>
        <div className="mono-data-sm" style={{ color: "var(--text-muted)", marginTop: 2 }}>
          {meta}
        </div>
      </div>
      <div className="mono-data" style={{ fontSize: 14, color: "var(--text-primary)", flex: "none", paddingTop: 1 }}>
        {formatMoney(row.costCents)}
      </div>
    </div>
  );
}

function FreeItems({ rows, expanded, onToggle }) {
  return (
    <div style={{ padding: "2px 6px" }}>
      <button
        type="button"
        onClick={onToggle}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
      >
        <span className="mono-caption">
          {rows.length} scheduled {rows.length === 1 ? "item" : "items"} with no cost
        </span>
        <span className="mono-caption" style={{ color: "var(--accent)" }}>
          {expanded ? "Hide" : "Show"}
        </span>
      </button>
      {expanded && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((row) => (
            <div key={row.key} style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0, font: "500 13px var(--font-sans)", color: "var(--text-secondary)" }}>
                {row.title}
              </div>
              <div className="mono-data-sm" style={{ color: "var(--text-faint)", flex: "none" }}>
                —
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
