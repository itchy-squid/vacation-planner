import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus } from "@fortawesome/free-solid-svg-icons";
import TripHeader from "../components/core/TripHeader";
import CostSheet from "../components/expenses/CostSheet";
import { expenseIcon } from "../lib/expenseTypes";
import { usePlannerState, useMyTraveler, useIdeaAccess } from "../state/PlannerContext";
import { GROUPINGS, buildExpenses, formatMoney, payerOf, travelersFor } from "../data/expenses";
import { getTripDays } from "../data/trip";
import { buildDailyCosts } from "../lib/dailyCosts";
import { tripDayNumbers } from "../lib/dayPlaces";
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
//
// Costs are listed by day or by category — the viewer picks, and it's one
// or the other, never a mix (data/expenses.js buildExpenses).
//
// Costs that aren't places — a park ticket, a rental car — are added and
// changed here (components/expenses/CostSheet.jsx), and nowhere else:
// they're never on the Ideas board. ?add=1 opens the sheet straight away
// (New idea's "Add as a cost"), with ?title= as its starting name, and
// ?cost=<id> opens that cost (Edit idea's ticket note).
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

// By day or by category, remembered per device the same way.
const GROUPING_KEY = "expenses.groupBy";
function readGrouping() {
  try {
    const v = window.localStorage.getItem(GROUPING_KEY);
    return GROUPINGS.includes(v) ? v : "day";
  } catch {
    return "day";
  }
}
function writeGrouping(v) {
  try {
    window.localStorage.setItem(GROUPING_KEY, v);
  } catch {
    // As above: not kept.
  }
}

export default function Expenses() {
  const state = usePlannerState();
  const { trip, plans, travelers, pins, costs, dayPlaces } = state;
  const me = useMyTraveler();
  const myId = me?.id ?? null;
  const { canAddIdeas, canSetCost } = useIdeaAccess();
  const canAddCost = canAddIdeas && canSetCost(null);

  // The cost sheet: { cost } to change one, { title } to add one.
  const [searchParams, setSearchParams] = useSearchParams();
  const [sheet, setSheet] = useState(() => {
    const opened = costs[Number(searchParams.get("cost"))];
    if (opened) return { cost: opened };
    return searchParams.get("add") && canAddCost ? { cost: null, title: searchParams.get("title") ?? "" } : null;
  });
  function closeSheet() {
    setSheet(null);
    if (searchParams.has("add") || searchParams.has("cost")) setSearchParams({}, { replace: true });
  }

  const [showFree, setShowFree] = useState(false);
  const [grouping, setGrouping] = useState(readGrouping);
  function chooseGrouping(value) {
    setGrouping(value);
    writeGrouping(value);
  }
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
  // Stays and prices paid by the day, counted over their days rather than
  // through the plans (lib/dailyCosts.js).
  const dailyCosts = useMemo(
    () =>
      buildDailyCosts({ ...pins, ...costs }, {
        dayPlaces,
        days: tripDayNumbers(trip),
        trip,
        travelers,
        shownIds: shown.map((t) => t.id),
      }),
    [pins, costs, dayPlaces, trip, travelers, shown]
  );
  const expenses = useMemo(
    () => buildExpenses(plans, { trip, travelers, shownIds: shown.map((t) => t.id), daily: dailyCosts.rows }),
    [plans, trip, travelers, shown, dailyCosts]
  );
  const groups = grouping === "category" ? expenses.byCategory : expenses.byDay;
  const dayCount = useMemo(() => getTripDays(trip).length, [trip]);
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

          <GroupingSwitch value={grouping} onChange={chooseGrouping} />

          {canAddCost && (
            <button
              type="button"
              onClick={() => setSheet({ cost: null, title: "" })}
              style={{
                height: 40,
                borderRadius: "var(--radius-lg)",
                border: "1.5px dashed var(--border-strong)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                font: "600 12.5px var(--font-sans)",
                color: "var(--accent)",
              }}
            >
              <FontAwesomeIcon icon={faPlus} style={{ width: 11, height: 11 }} />
              Add an expense
            </button>
          )}

          {dailyCosts.waiting.length > 0 && (
            <WaitingForDays items={dailyCosts.waiting} tripId={trip.id} onOpenCost={(pinId) => costs[pinId] && setSheet({ cost: costs[pinId] })} />
          )}

          {groups.map((g) => (
            <GroupCard
              key={g.key}
              label={g.label}
              subtotalCents={g.shownCents}
              rows={g.rows}
              onOpenCost={(pinId) => costs[pinId] && setSheet({ cost: costs[pinId] })}
            />
          ))}

          {groups.length === 0 && (
            <div
              style={{
                borderRadius: "var(--radius-lg)",
                border: "1.5px dashed var(--border-strong)",
                padding: "15px 16px",
                font: "400 12.5px var(--font-sans)",
                color: "var(--text-secondary)",
              }}
            >
              Nothing on the calendar costs anything yet. Add a cost to a visit, or add an expense above, and it shows up here.
            </div>
          )}

          {expenses.freeRows.length > 0 && (
            <FreeItems rows={expenses.freeRows} expanded={showFree} onToggle={() => setShowFree((v) => !v)} />
          )}
        </div>
      </div>
      {sheet && <CostSheet key={sheet.cost?.id ?? "new"} cost={sheet.cost} title={sheet.title} onClose={closeSheet} />}
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

function GroupingSwitch({ value, onChange }) {
  const options = [
    { value: "day", label: "By day" },
    { value: "category", label: "By category" },
  ];
  return (
    <div role="group" aria-label="Group expenses" style={{ display: "flex", background: "var(--surface-sunken)", borderRadius: "var(--radius-md)", padding: 2 }}>
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(opt.value)}
            style={{
              flex: 1,
              padding: "7px 0",
              borderRadius: "calc(var(--radius-md) - 2px)",
              background: on ? "var(--surface-card)" : "transparent",
              boxShadow: on ? "var(--shadow-raised)" : "none",
              font: "600 12px var(--font-sans)",
              color: on ? "var(--text-primary)" : "var(--text-secondary)",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// A day or a category, with what its costs come to for the people shown.
function GroupCard({ label, subtotalCents, rows, onOpenCost }) {
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
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div className="serif-place" style={{ fontSize: 17, color: "var(--text-primary)" }}>
          {label}
        </div>
        <div className="mono-data" style={{ fontSize: 13, color: "var(--text-secondary)", flex: "none" }}>
          {formatMoney(subtotalCents)}
        </div>
      </div>
      {rows.map((row) => (
        <ExpenseRow key={row.key} row={row} onOpen={row.kind === "expense" ? () => onOpenCost(row.pinId) : null} />
      ))}
    </div>
  );
}

function ExpenseRow({ row, onOpen }) {
  // Per person first — that's how prices are entered and compared. A
  // group price says so, with what it comes to each.
  const price =
    row.costBasis === "group"
      ? `${formatMoney(row.totalCents)} group · ${formatMoney(row.eachCents)} each`
      : `${formatMoney(row.eachCents)} each`;
  const meta = [
    row.startMinuteOfDay != null ? clockLabel(row.startMinuteOfDay) : null,
    // When it is (by category), or a stay's or per-day price's days.
    row.howLabel ?? null,
    price,
    `${row.headcount} ${row.headcount === 1 ? "person" : "people"}`,
    row.sharersLabel || null,
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
        {onOpen ? (
          // A ticket or rental: changed here, so its name opens it.
          <button type="button" onClick={onOpen} style={{ font: "600 14px var(--font-sans)", color: "var(--text-primary)", textAlign: "left", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <FontAwesomeIcon icon={expenseIcon(row.expenseType)} style={{ width: 11, height: 11, color: "var(--text-secondary)" }} />
            {row.title}
          </button>
        ) : (
          <div style={{ font: "600 14px var(--font-sans)", color: "var(--text-primary)" }}>{row.title}</div>
        )}
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

// Priced by the day but with no days to count yet: a stay nobody's picked
// as where they're staying, or a per-day price with no first and last day.
function WaitingForDays({ items, tripId, onOpenCost }) {
  return (
    <div style={{ borderRadius: "var(--radius-lg)", border: "1.5px dashed var(--border-strong)", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="mono-caption">Not counted yet</div>
      {items.map((item) => (
        <div key={item.key} style={{ font: "400 12.5px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>
          {item.kind === "expense" ? (
            <button type="button" onClick={() => onOpenCost(item.pinId)} style={{ font: "600 12.5px var(--font-sans)", color: "var(--text-primary)", textDecoration: "underline" }}>
              {item.title}
            </button>
          ) : (
            <Link to={`/trips/${tripId}/edit/${item.pinId}?from=board`} style={{ font: "600 12.5px var(--font-sans)", color: "var(--text-primary)" }}>
              {item.title}
            </Link>
          )}{" "}
          {item.kind === "stay"
            ? "isn’t picked as where you’re staying on any night."
            : item.kind === "expense"
            ? "has no days picked."
            : "is paid by the day but has no days picked."}
        </div>
      ))}
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
