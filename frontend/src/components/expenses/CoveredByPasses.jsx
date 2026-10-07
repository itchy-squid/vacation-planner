import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTicket } from "@fortawesome/free-solid-svg-icons";
import { usePlannerDispatch, usePlannerState, useIdeaAccess } from "../../state/PlannerContext";
import { passesByPin } from "../../lib/expenseTypes";
import { chargedDays } from "../../lib/dailyCosts";

// On Edit idea, above the price: the tickets that get people into this
// place (components/expenses/CostSheet.jsx "Covers these ideas"). Their
// holders don't pay its own price on the ticket's days (backend app/
// derive.py pass_holders), so the price below is what everyone else pays.
// "Turn off" takes this place off a ticket that covers it by mistake.
export default function CoveredByPasses({ pinId }) {
  const { costs, travelers, trip } = usePlannerState();
  const dispatch = usePlannerDispatch();
  const { canEditIdea, canSetCost } = useIdeaAccess();
  const passes = useMemo(() => passesByPin(costs).get(pinId) ?? [], [costs, pinId]);
  const [busyId, setBusyId] = useState(null);
  if (!passes.length) return null;

  const names = new Map(travelers.map((t) => [t.id, t.name]));
  function whoFor(pass) {
    if (pass.travelerIds == null) return "Covers everyone";
    const held = pass.travelerIds.map((id) => names.get(id)).filter(Boolean);
    return held.length ? `Covers ${held.join(", ")}` : "Covers nobody on the trip";
  }
  function when(pass) {
    const { label } = chargedDays(pass, { trip });
    return label ? ` · ${label}` : "";
  }
  async function turnOff(pass) {
    setBusyId(pass.id);
    const rest = pass.coversPinIds.filter((id) => id !== pinId);
    const result = await dispatch({ type: "PATCH_PIN", id: pass.id, fields: { coversPinIds: rest.length ? rest : null } });
    // This place's plans now cost its holders its own price again (worked
    // out on the server, backend app/derive.py pass_holders).
    if (result.ok) await dispatch({ type: "REFRESH_PLANS_AND_ITEMS" }).catch(() => {});
    setBusyId(null);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {passes.map((pass) => (
        <div
          key={pass.id}
          style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid var(--border)", background: "var(--geo-quiet)", borderRadius: "var(--radius-lg)", padding: "10px 12px" }}
        >
          <FontAwesomeIcon icon={faTicket} style={{ width: 14, height: 14, color: "var(--geo)", flex: "none" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: "600 13px var(--font-sans)", color: "var(--text-primary)" }}>{pass.title}</div>
            <div className="mono-data-sm" style={{ color: "var(--text-secondary)", marginTop: 2 }}>
              {whoFor(pass)}
              {when(pass)}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flex: "none" }}>
            <Link to={`/trips/${trip.id}/expenses?cost=${pass.id}`} style={{ font: "600 12px var(--font-sans)", color: "var(--accent)" }}>
              Open
            </Link>
            {canEditIdea(pass) && canSetCost(pass) ? (
              <button type="button" disabled={busyId === pass.id} onClick={() => turnOff(pass)} style={{ font: "600 11.5px var(--font-sans)", color: "var(--text-secondary)" }}>
                Turn off
              </button>
            ) : null}
          </div>
        </div>
      ))}
      <div style={{ font: "400 11.5px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>
        Ticket holders don’t pay this place’s own price on the ticket’s days. The price below is for everyone else.
      </div>
    </div>
  );
}
