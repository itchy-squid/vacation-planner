import { useMemo, useState } from "react";
import TripHeader from "../components/core/TripHeader";
import { usePlannerState, useMyTraveler } from "../state/PlannerContext";
import { buildExpenses, formatMoney, payerOf, travelersFor } from "../data/expenses";
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

// Whose costs the screen shows, remembered per device (it's a view, not
// a fact about the trip).
const SCOPE_KEY = "expenses.scope";
function readScope() {
  try {
    const v = window.localStorage.getItem(SCOPE_KEY);
    if (v === "paying" || v === "me" || v === "everyone") return v;
    return v && /^\d+$/.test(v) ? Number(v) : null;
  } catch {
    return null;
  }
}
function writeScope(v) {
  try {
    window.localStorage.setItem(SCOPE_KEY, String(v));
  } catch {
    // Private windows and blocked storage: the choice just isn't kept.
  }
}

export default function Expenses() {
  const state = usePlannerState();
  const { trip, plans, travelers } = state;
  const me = useMyTraveler();
  const myId = me?.id ?? null;

  const [showFree, setShowFree] = useState(false);
  // What I'm paying (me plus the people I pay for) is the default; someone
  // planning but not going has nobody's costs of their own, so they start
  // on everyone.
  const [scopeChoice, setScopeChoice] = useState(readScope);
  const validScope = (s) =>
    s === "everyone" || ((s === "paying" || s === "me") && myId != null) || travelers.some((t) => t.id === s);
  const scope = validScope(scopeChoice) ? scopeChoice : myId != null ? "paying" : "everyone";
  function choose(value) {
    const next = /^\d+$/.test(value) ? Number(value) : value;
    setScopeChoice(next);
    writeScope(next);
  }

  const shown = useMemo(() => travelersFor(scope, travelers, myId), [scope, travelers, myId]);
  const expenses = useMemo(
    () => buildExpenses(plans, { trip, travelers, shownIds: shown.map((t) => t.id) }),
    [plans, trip, travelers, shown]
  );
  const dayCount = useMemo(() => getTripDays(trip.startDate, trip.endDate).length, [trip.startDate, trip.endDate]);
  const payingFor = myId != null ? travelers.filter((t) => payerOf(t) === myId) : [];

  const summaryLabel =
    scope === "paying"
      ? `You pay · ${payingFor.length} ${payingFor.length === 1 ? "person" : "people"}`
      : scope === "me"
      ? "Your own costs"
      : scope === "everyone"
      ? "Everyone"
      : `${shown[0]?.name ?? "Traveler"}’s costs`;

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

        <div style={{ padding: "6px var(--gutter-text) 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div className="mono-caption">
            Expenses · {dayCount} {dayCount === 1 ? "day" : "days"} · {travelers.length}{" "}
            {travelers.length === 1 ? "traveler" : "travelers"}
          </div>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span className="mono-caption">Showing</span>
            <select
              id="expenses-scope"
              value={String(scope)}
              onChange={(e) => choose(e.target.value)}
              style={{
                height: 30,
                borderRadius: 15,
                border: "1px solid var(--border)",
                background: "var(--surface-card)",
                padding: "0 10px",
                font: "600 12px var(--font-sans)",
                color: "var(--text-primary)",
              }}
            >
              {myId != null && <option value="paying">What I&rsquo;m paying</option>}
              {myId != null && <option value="me">Just me</option>}
              <option value="everyone">Everyone</option>
              {travelers.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px var(--gutter-screen) 0" }}>
          <SummaryCard
            label={summaryLabel}
            shownCents={expenses.shownCents}
            tripTotalCents={expenses.tripTotalCents}
            perTraveler={shown.length > 1 ? expenses.perTraveler : []}
          />

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

function SummaryCard({ label, shownCents, tripTotalCents, perTraveler }) {
  return (
    <div
      style={{
        background: "var(--surface-card)",
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--hairline)",
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 14 }}>
        <div>
          <div className="mono-caption">{label}</div>
          <div className="serif-place" style={{ fontSize: 34, lineHeight: 1, marginTop: 6, color: "var(--text-primary)" }}>
            {formatMoney(shownCents)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="mono-caption">Trip total</div>
          <div className="serif-place" style={{ fontSize: 22, lineHeight: 1, marginTop: 6, color: "var(--stone-700)" }}>
            {formatMoney(tripTotalCents)}
          </div>
        </div>
      </div>
      {perTraveler.length > 0 && (
        // Each person's part of the number above — what settling up reads.
        <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 10, display: "grid", gridTemplateColumns: "1fr auto", gap: "6px 12px" }}>
          {perTraveler.map(({ traveler, cents }) => (
            <div key={traveler.id} style={{ display: "contents" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7, font: "500 12.5px var(--font-sans)", color: "var(--text-primary)" }}>
                <span style={{ width: 18, height: 18, borderRadius: "50%", background: traveler.tint, display: "inline-flex", alignItems: "center", justifyContent: "center", font: "600 8.5px var(--font-sans)", color: "var(--text-secondary)" }}>
                  {traveler.initial}
                </span>
                {traveler.name}
              </span>
              <span className="mono-data" style={{ fontSize: 12.5, textAlign: "right", color: "var(--text-primary)" }}>
                {formatMoney(cents)}
              </span>
            </div>
          ))}
        </div>
      )}
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
  // Per person first — that's how prices are entered and compared. A
  // group price says so, with what it comes to each.
  const price =
    row.costBasis === "group"
      ? `${formatMoney(row.totalCents)} group · ${formatMoney(row.eachCents)} each`
      : `${formatMoney(row.eachCents)} each`;
  const meta = [
    row.startMinuteOfDay != null ? clockLabel(row.startMinuteOfDay) : null,
    price,
    `${row.headcount} ${row.headcount === 1 ? "person" : "people"}`,
    row.headsLabel || null,
  ]
    .filter(Boolean)
    .join(" · ");
  const involved = row.shownCount > 0;

  return (
    // A cost only other people share — the other group's half of a split
    // day, say — still counts toward the trip total, but it isn't yours,
    // so it steps back.
    <div style={{ display: "flex", alignItems: "stretch", gap: 12, opacity: involved ? 1 : 0.55 }}>
      {/* Teal for the trip's money, plum for money that's the viewer's own
          share — the same two meanings those hues carry everywhere else in
          the app (design_system readme, "Colour"). */}
      <div
        aria-hidden="true"
        style={{ width: 3, borderRadius: 2, flex: "none", background: involved ? "var(--accent)" : "var(--geo)" }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: "600 14px var(--font-sans)", color: "var(--text-primary)" }}>{row.title}</div>
        <div className="mono-data-sm" style={{ color: "var(--text-muted)", marginTop: 2 }}>
          {meta}
        </div>
      </div>
      <div style={{ flex: "none", paddingTop: 1, textAlign: "right" }}>
        <div className="mono-data" style={{ fontSize: 14, color: involved ? "var(--text-primary)" : "var(--text-muted)" }}>
          {involved ? formatMoney(row.shownCents) : "—"}
        </div>
        {/* The whole bill, when what's shown is only part of it. */}
        {row.shownCents !== row.totalCents && (
          <div className="mono-data-sm" style={{ color: "var(--text-muted)", marginTop: 2 }}>
            of {formatMoney(row.totalCents)}
          </div>
        )}
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
