import { faCar, faReceipt, faTicket } from "@fortawesome/free-solid-svg-icons";

// What an expense is (backend models.py Pin.expense_type), in the order
// the cost sheet offers them (components/expenses/CostSheet.jsx). Picking
// one on a new cost sets how it's usually charged: a rental by the day for
// the group, a ticket once per person.
export const EXPENSE_TYPES = [
  { value: "pass", label: "Ticket or pass", icon: faTicket, per: "once", basis: "per_head", placeholder: "Universal 5-day ticket" },
  { value: "rental", label: "Rental", icon: faCar, per: "day", basis: "group", placeholder: "Rental car" },
  { value: "other", label: "Other", icon: faReceipt, per: "once", basis: "group", placeholder: "Resort parking" },
];

export function expenseIcon(type) {
  return (EXPENSE_TYPES.find((t) => t.value === type) ?? EXPENSE_TYPES[2]).icon;
}

// Words in a New idea search that mean a cost rather than a place
// (components/newpin/PlaceSearchStep.jsx offers "Add as a cost" first).
const COST_WORDS = /\b(rentals?|rent a car|car hire|tickets?|pass(es)?|parking|insurance|fees?|wristbands?|lift tickets?)\b/i;

export function looksLikeCost(query) {
  return COST_WORDS.test(query ?? "");
}

/** pinId -> the passes (state.costs) that cover it, for the Ideas board and Edit idea. */
export function passesByPin(costs) {
  const byPin = new Map();
  Object.values(costs ?? {}).forEach((cost) => {
    (cost.coversPinIds ?? []).forEach((pinId) => {
      if (!byPin.has(pinId)) byPin.set(pinId, []);
      byPin.get(pinId).push(cost);
    });
  });
  return byPin;
}

/** Whether `passes` get every traveler in — so the idea's own price is nobody's to pay (on the passes' days). */
export function coversEveryone(passes, travelers) {
  if (passes.some((p) => p.travelerIds == null)) return true;
  const held = new Set(passes.flatMap((p) => p.travelerIds));
  return travelers.length > 0 && travelers.every((t) => held.has(t.id));
}
