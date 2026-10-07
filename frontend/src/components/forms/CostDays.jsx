import { chargedDays, dailyMoney, daysWord } from "../../lib/dailyCosts";
import { tripDayNumbers } from "../../lib/dayPlaces";
import { formatMoney } from "../../data/expenses";
import { tripDayLabel } from "../../data/trip";

// Under a cost paid by the day (components/forms/CostField.jsx): which
// days it covers, and what it comes to. A stay's days are its nights in
// Where we'll be, so they're shown, not picked; anything else picks its
// first and last day from the trip's days. n days from first to last is
// n - 1 days' worth (lib/dailyCosts.js). An expense (components/expenses/
// CostSheet.jsx) picks its days even when it's paid once: a ticket's days
// are when it's used, and it falls on the first of them.
//
//   pin        the idea as drafted: { id, kind, expenseType, costPer, costCents, costBasis, costStartDay, costEndDay }
//   trip       the trip: its days, and the dates they fall on if it has them
//   dayPlaces  day -> { lodgingPinId, ... }
//   headcount  how many travelers share it
//   onDays     ({ first, last }) — only for an idea that isn't a stay
//   onPlaces   open Where we'll be — only for a stay
export default function CostDays({ pin, trip, dayPlaces, headcount, onDays, onPlaces, disabled = false }) {
  const tripDays = tripDayNumbers(trip);
  const days = chargedDays(pin, { dayPlaces, days: tripDays, trip });
  const stay = pin.kind === "stay";
  const expense = pin.kind === "expense";
  const daily = pin.costPer === "day";
  const [firstLabel, lastLabel] =
    expense && pin.expenseType === "rental"
      ? ["Pick up", "Drop off"]
      : expense && pin.expenseType === "pass"
      ? ["First day used", "Last day used"]
      : ["First day", "Last day"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {stay ? (
        <div style={{ font: "400 12px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>
          {days.count
            ? `Staying here ${daysWord(pin, days.nights)} in Where we’ll be (${days.label}).`
            : "Not picked as where you’re staying on any night yet."}{" "}
          {onPlaces ? (
            <button type="button" onClick={onPlaces} style={{ font: "600 12px var(--font-sans)", color: "var(--accent)" }}>
              {days.count ? "Change nights" : "Pick nights"}
            </button>
          ) : null}
        </div>
      ) : daily || expense ? (
        tripDays.length ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <DaySelect
              id="cost-first-day"
              label={firstLabel}
              value={pin.costStartDay}
              days={tripDays}
              trip={trip}
              disabled={disabled}
              onChange={(first) => onDays({ first, last: pin.costEndDay != null && pin.costEndDay >= first ? pin.costEndDay : first })}
            />
            <DaySelect
              id="cost-last-day"
              label={lastLabel}
              value={pin.costEndDay}
              days={tripDays.filter((d) => pin.costStartDay == null || d >= pin.costStartDay)}
              trip={trip}
              disabled={disabled}
              onChange={(last) => onDays({ first: pin.costStartDay ?? last, last })}
            />
          </div>
        ) : (
          <div style={{ font: "400 12px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>
            Set the trip’s dates, or how long it is, to pick which days this is for.
          </div>
        )
      ) : null}
      {daily || stay || expense ? <Receipt pin={pin} days={days} headcount={headcount} /> : null}
    </div>
  );
}

function Receipt({ pin, days, headcount }) {
  const rate = pin.costCents ?? 0;
  if (!rate) return null;
  const { eachCents, totalCents } = dailyMoney(pin, days.count, headcount);
  const group = (pin.costBasis ?? "per_head") === "group";
  const lines = [];
  if (!days.count) {
    lines.push(["No days picked yet", formatMoney(0)]);
  } else if (pin.costPer === "day") {
    lines.push([`${daysWord(pin, days.count)} × ${formatMoney(rate)}`, `${formatMoney(group ? totalCents : eachCents)} ${group ? "group" : "each"}`]);
    lines.push(group ? [`÷ ${headcount} going`, `${formatMoney(eachCents)} each`] : [`× ${headcount} going`, `${formatMoney(totalCents)} group`]);
  } else {
    lines.push([pin.kind === "stay" ? "Paid once for the stay" : "Paid once", `${formatMoney(group ? totalCents : eachCents)} ${group ? "group" : "each"}`]);
    if (pin.kind === "expense") lines.push(group ? [`÷ ${headcount} going`, `${formatMoney(eachCents)} each`] : [`× ${headcount} going`, `${formatMoney(totalCents)} group`]);
  }
  return (
    <div
      aria-live="polite"
      className="mono-data-sm"
      style={{
        background: "var(--surface-inset)",
        border: "1px dashed var(--border-strong)",
        borderRadius: "var(--radius-lg)",
        padding: "9px 12px",
        color: "var(--text-secondary)",
        display: "flex",
        flexDirection: "column",
        gap: 3,
      }}
    >
      {lines.map(([label, amount], i) => (
        <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span>{label}</span>
          <span style={{ color: i === 0 ? "var(--text-primary)" : undefined }}>{amount}</span>
        </div>
      ))}
    </div>
  );
}

function DaySelect({ id, label, value, days, trip, onChange, disabled }) {
  return (
    <label htmlFor={id} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span className="mono-caption">{label}</span>
      <select
        id={id}
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          height: 40,
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border-strong)",
          background: "var(--surface-page)",
          padding: "0 10px",
          font: "600 13px var(--font-sans)",
          color: "var(--text-primary)",
        }}
      >
        {value != null ? null : <option value="">Pick a day</option>}
        {days.map((day) => (
          <option key={day} value={day}>
            {tripDayLabel(day, trip)}
          </option>
        ))}
      </select>
    </label>
  );
}
