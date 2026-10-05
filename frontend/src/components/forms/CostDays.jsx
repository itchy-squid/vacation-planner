import { chargedDays, dailyMoney, daysWord } from "../../lib/dailyCosts";
import { formatMoney } from "../../data/expenses";

// Under a cost paid by the day (components/forms/CostField.jsx): which
// days it covers, and what it comes to. A stay's days are its nights in
// Where we'll be, so they're shown, not picked; anything else picks its
// first and last day from the trip's days. n days from first to last is
// n - 1 days' worth (lib/dailyCosts.js).
//
//   pin        the idea as drafted: { id, kind, costPer, costCents, costBasis, costStartDate, costEndDate }
//   dates      the trip's days, ISO
//   dayPlaces  date -> { lodgingPinId, ... }
//   headcount  how many travelers share it
//   onDays     ({ first, last }) — only for an idea that isn't a stay
//   onPlaces   open Where we'll be — only for a stay
export default function CostDays({ pin, dates, dayPlaces, headcount, onDays, onPlaces, disabled = false }) {
  const days = chargedDays(pin, { dayPlaces, dates });
  const stay = pin.kind === "stay";
  const daily = pin.costPer === "day";

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
      ) : daily ? (
        dates.length ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <DaySelect
              id="cost-first-day"
              label="First day"
              value={pin.costStartDate ?? ""}
              dates={dates}
              disabled={disabled}
              onChange={(first) => onDays({ first, last: pin.costEndDate && pin.costEndDate >= first ? pin.costEndDate : first })}
            />
            <DaySelect
              id="cost-last-day"
              label="Last day"
              value={pin.costEndDate ?? ""}
              dates={dates.filter((d) => !pin.costStartDate || d >= pin.costStartDate)}
              disabled={disabled}
              onChange={(last) => onDays({ first: pin.costStartDate ?? last, last })}
            />
          </div>
        ) : (
          <div style={{ font: "400 12px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>
            Set the trip’s dates to pick which days this is for.
          </div>
        )
      ) : null}
      {daily || stay ? <Receipt pin={pin} days={days} headcount={headcount} /> : null}
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
    lines.push(["Paid once for the stay", `${formatMoney(group ? totalCents : eachCents)} ${group ? "group" : "each"}`]);
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

function DaySelect({ id, label, value, dates, onChange, disabled }) {
  return (
    <label htmlFor={id} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span className="mono-caption">{label}</span>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
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
        {value ? null : <option value="">Pick a day</option>}
        {dates.map((date) => (
          <option key={date} value={date}>
            {dayLabel(date)}
          </option>
        ))}
      </select>
    </label>
  );
}

function dayLabel(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
