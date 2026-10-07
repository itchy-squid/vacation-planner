import { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck } from "@fortawesome/free-solid-svg-icons";
import BottomSheet from "../core/BottomSheet";
import Button from "../core/Button";
import CostField from "../forms/CostField";
import CostDays from "../forms/CostDays";
import { Avatar } from "../sharing/PeopleList";
import { usePlannerDispatch, usePlannerState, useIdeaAccess } from "../../state/PlannerContext";
import { tripDayNumbers } from "../../lib/dayPlaces";
import { formatMoney } from "../../data/expenses";
import { EXPENSE_TYPES } from "../../lib/expenseTypes";

// Add or change a cost that isn't a place: a park ticket, a rental car,
// parking (backend models.py Pin.kind "expense"). It's kept here in
// Expenses, never on the Ideas board, and asks for nothing a place has —
// no region, spot on the map or duration. What it does ask:
//
//   what it is   a ticket or pass, a rental, or something else. Picking one
//                on a new cost sets the usual way it's charged (a rental by
//                the day for the group, a ticket once per person).
//   its price    once or per day, per person or for the group (CostField)
//   its days     a rental's pick-up and drop-off, the days a ticket's used
//                (CostDays). Paid once, it falls on the first.
//   who for      everyone, or only some of the travelers
//   covers       a pass only: the ideas it gets its holders into. On those
//                ideas' plans, holders don't pay the idea's own price
//                (backend app/derive.py pass_holders).
//
//   cost     the expense to change (state.costs), or null to add one
//   title    a starting name for a new one (from New idea's search)
export default function CostSheet({ cost = null, title: startTitle = "", onClose }) {
  const { trip, travelers, pins, dayPlaces } = usePlannerState();
  const dispatch = usePlannerDispatch();
  const { canEditIdea, canSetCost } = useIdeaAccess();
  const isNew = cost == null;
  const editable = isNew ? canSetCost(null) : canEditIdea(cost) && canSetCost(cost);
  const tripDays = tripDayNumbers(trip);

  const [type, setType] = useState(cost?.expenseType ?? "pass");
  const [title, setTitle] = useState(cost?.title ?? startTitle);
  const [price, setPrice] = useState(cost?.cost != null ? String(cost.cost) : "");
  const [basis, setBasis] = useState(cost?.costBasis ?? "per_head");
  const [per, setPer] = useState(cost?.costPer ?? "once");
  const [days, setDays] = useState(
    cost?.costStartDay != null
      ? { first: cost.costStartDay, last: cost.costEndDay }
      : tripDays.length
      ? { first: tripDays[0], last: tripDays[tripDays.length - 1] }
      : null
  );
  // null is everyone, which is also what it stays as people join the trip.
  const [who, setWho] = useState(cost?.travelerIds ?? null);
  const [covers, setCovers] = useState(cost?.coversPinIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const chosen = who == null ? travelers.map((t) => t.id) : who.filter((id) => travelers.some((t) => t.id === id));
  const ideas = useMemo(
    () => Object.values(pins).filter((p) => p.kind === "activity").sort((a, b) => a.title.localeCompare(b.title)),
    [pins]
  );

  function pickType(value) {
    setType(value);
    if (isNew) {
      const preset = EXPENSE_TYPES.find((t) => t.value === value);
      setPer(preset.per);
      setBasis(preset.basis);
    }
  }

  function toggleTraveler(id) {
    const next = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
    setWho(next.length === travelers.length ? null : next);
  }

  function toggleCover(id) {
    setCovers((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  }

  const draft = {
    id: cost?.id ?? null,
    kind: "expense",
    expenseType: type,
    costPer: per,
    costCents: Math.round((Number(price) || 0) * 100),
    costBasis: basis,
    costStartDay: days?.first ?? null,
    costEndDay: days?.last ?? null,
  };
  const ready = title.trim() && chosen.length > 0 && days != null && editable && !busy;

  async function save() {
    if (!ready) return;
    setBusy(true);
    setError("");
    const coversPinIds = type === "pass" && covers.length ? covers : null;
    try {
      if (isNew) {
        await dispatch({
          type: "CREATE_PIN",
          payload: {
            title: title.trim(),
            place: "",
            region: "",
            kind: "expense",
            expense_type: type,
            cost_cents: draft.costCents,
            cost_basis: basis,
            cost_per: per,
            cost_start_day: days.first,
            cost_end_day: days.last,
            traveler_ids: who,
            covers_pin_ids: coversPinIds,
          },
        });
      } else {
        const result = await dispatch({
          type: "PATCH_PIN",
          id: cost.id,
          fields: {
            title: title.trim(),
            expenseType: type,
            cost: draft.costCents / 100,
            costBasis: basis,
            costPer: per,
            costDays: days,
            travelerIds: who,
            coversPinIds,
          },
        });
        if (!result.ok) throw new Error(result.error);
      }
      await refreshCoveredStops();
      onClose();
    } catch (err) {
      setError(err.message || "Couldn’t save this cost.");
      setBusy(false);
    }
  }

  // What a covered stop costs is worked out on the server, per plan
  // (backend app/derive.py pass_holders), so a pass that changed means the
  // plans' money has to be fetched again.
  async function refreshCoveredStops() {
    if (type !== "pass" && cost?.expenseType !== "pass") return;
    try {
      await dispatch({ type: "REFRESH_PLANS_AND_ITEMS" });
    } catch (err) {
      console.error("refreshing plans after a pass changed failed", err);
    }
  }

  async function remove() {
    setBusy(true);
    const result = await dispatch({ type: "DELETE_PIN", id: cost.id });
    if (result.ok) {
      await refreshCoveredStops();
      onClose();
    } else {
      setError(result.error || "Couldn’t remove this cost.");
      setBusy(false);
    }
  }

  const sheetTitle = isNew ? "Add a cost" : title || "Cost";
  return (
    <BottomSheet label={sheetTitle} onClose={onClose}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "6px 18px 12px", borderBottom: "1px solid var(--hairline)", flex: "none" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mono-caption">Expenses</div>
          <div className="serif-place" style={{ fontSize: 21, lineHeight: 1.2, color: "var(--text-primary)", marginTop: 2 }}>
            {sheetTitle}
          </div>
        </div>
        <button type="button" onClick={onClose} style={{ font: "600 13.5px var(--font-sans)", color: "var(--accent)", paddingTop: 4 }}>
          Cancel
        </button>
      </div>

      <div className="screen-scroll" style={{ padding: "14px 18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div role="group" aria-label="What it is" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          {EXPENSE_TYPES.map((opt) => {
            const on = opt.value === type;
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={on}
                disabled={!editable}
                onClick={() => pickType(opt.value)}
                style={{
                  border: `1px solid ${on ? "var(--surface-inverse)" : "var(--border)"}`,
                  background: on ? "var(--surface-inverse)" : "var(--surface-card)",
                  color: on ? "#fff" : "var(--text-primary)",
                  borderRadius: "var(--radius-lg)",
                  padding: "9px 4px 8px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 5,
                  font: "500 11.5px/1.15 var(--font-sans)",
                }}
              >
                <FontAwesomeIcon icon={opt.icon} style={{ width: 15, height: 15 }} />
                {opt.label}
              </button>
            );
          })}
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="mono-caption">Name</span>
          <input
            value={title}
            disabled={!editable}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={EXPENSE_TYPES.find((t) => t.value === type).placeholder}
            style={{
              height: 44,
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--border-strong)",
              background: "var(--surface-page)",
              padding: "0 13px",
              font: "600 14px var(--font-sans)",
              color: "var(--text-primary)",
            }}
          />
        </label>

        <CostField id="cost-sheet-price" value={price} onChange={setPrice} basis={basis} onBasis={setBasis} per={per} onPer={setPer} disabled={!editable}>
          <CostDays pin={draft} trip={trip} dayPlaces={dayPlaces} headcount={chosen.length} onDays={setDays} disabled={!editable} />
        </CostField>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="mono-caption">Who’s it for</div>
          <div role="group" aria-label="Who it's for" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {travelers.map((t) => {
              const on = chosen.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={on}
                  disabled={!editable}
                  onClick={() => toggleTraveler(t.id)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 11px 4px 4px",
                    borderRadius: "var(--radius-pill)",
                    border: `1px ${on ? "solid" : "dashed"} ${on ? "var(--surface-inverse)" : "var(--border-strong)"}`,
                    background: "var(--surface-card)",
                    font: "500 12.5px var(--font-sans)",
                    color: on ? "var(--text-primary)" : "var(--text-muted)",
                    opacity: on ? 1 : 0.8,
                  }}
                >
                  <Avatar person={t} size={20} />
                  {t.name}
                </button>
              );
            })}
          </div>
          <div style={{ font: "400 11.5px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>
            {who == null ? "Everyone on the trip, including anyone added later." : chosen.length ? `${chosen.length} of ${travelers.length} travelers.` : "Pick at least one traveler."}
          </div>
        </div>

        {type === "pass" && ideas.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div className="mono-caption">Covers these ideas</div>
            <div style={{ font: "400 11.5px/1.45 var(--font-sans)", color: "var(--text-secondary)", marginBottom: 2 }}>
              Ticket holders don’t pay these places’ own prices on the ticket’s days.
            </div>
            {ideas.map((idea) => {
              const on = covers.includes(idea.id);
              return (
                <button
                  key={idea.id}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  disabled={!editable}
                  onClick={() => toggleCover(idea.id)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--hairline)", textAlign: "left" }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 5,
                      flex: "none",
                      display: "grid",
                      placeItems: "center",
                      border: `1.5px solid ${on ? "var(--surface-inverse)" : "var(--border-strong)"}`,
                      background: on ? "var(--surface-inverse)" : "transparent",
                      color: "#fff",
                    }}
                  >
                    {on ? <FontAwesomeIcon icon={faCheck} style={{ width: 9, height: 9 }} /> : null}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, font: "500 13px var(--font-sans)", color: "var(--text-primary)" }}>{idea.title}</span>
                  {idea.costCents ? (
                    <span className="mono-data-sm" style={{ color: "var(--text-muted)", flex: "none" }}>
                      {formatMoney(idea.costCents)}
                      {idea.costBasis === "group" ? "" : " each"}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}

        {error ? <div style={{ font: "500 12.5px var(--font-sans)", color: "var(--warn)" }}>{error}</div> : null}

        {editable ? (
          <div style={{ display: "flex", gap: 8 }}>
            {!isNew ? (
              <Button variant="secondary" onClick={remove} disabled={busy}>
                Remove
              </Button>
            ) : null}
            <Button onClick={save} disabled={!ready}>
              {isNew ? "Add cost" : "Save"}
            </Button>
          </div>
        ) : (
          <div style={{ font: "400 12px var(--font-sans)", color: "var(--text-secondary)" }}>Only whoever added this cost, or a planner, can change it.</div>
        )}
      </div>
    </BottomSheet>
  );
}
