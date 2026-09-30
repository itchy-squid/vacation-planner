import { useState } from "react";
import BottomSheet from "../core/BottomSheet";
import Button from "../core/Button";
import Stepper from "../forms/Stepper";
import CostField from "../forms/CostField";
import { clockLabel } from "../../lib/planTime";
import { formatDuration } from "../../lib/format";
import { formatMoney } from "../../data/expenses";
import { MIN_VISIT_MIN, VISIT_STEP_MIN } from "../../lib/tripPlan";

/**
 * One stop's details: how long, and what it costs. The cost belongs to
 * the idea or event itself, so a change is saved back to it — the same
 * rule the calendar's item sheet follows.
 *
 *   item        the stop's entry in buildTrip(...).seq
 *   headcount   how many people it's for, for "× 5 = $100"
 *   seeCost / setCost  whether this viewer can see / change the cost
 *   onDone({ minutes, costCents, costBasis }) -> Promise<string | null>, an error
 */
export default function StopSheet({ item, headcount, seeCost, setCost, onDone, onRemove, onClose }) {
  const { pin } = item.stop;
  const [minutes, setMinutes] = useState(item.minutes);
  const [cost, setCostValue] = useState((pin.costCents ?? 0) / 100);
  const [basis, setBasis] = useState(pin.costBasis ?? "per_head");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cents = Math.max(0, Math.round((Number(cost) || 0) * 100));
  const people = Math.max(1, headcount);

  async function done() {
    setBusy(true);
    setError("");
    const problem = await onDone({ minutes, costCents: cents, costBasis: basis });
    setBusy(false);
    if (problem) setError(problem);
  }

  return (
    <BottomSheet label={pin.title} onClose={onClose}>
      <div className="screen-scroll" style={{ padding: "8px 18px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div className="mono-caption">
            {clockLabel(item.start)}–{clockLabel(item.start + minutes)}
          </div>
          <div className="serif-place" style={{ fontSize: 19, marginTop: 3 }}>
            {pin.title}
          </div>
        </div>
        <Stepper
          label="How long"
          valueLabel={formatDuration(minutes)}
          downDisabled={minutes <= MIN_VISIT_MIN}
          onDown={() => setMinutes((m) => Math.max(MIN_VISIT_MIN, m - VISIT_STEP_MIN))}
          onUp={() => setMinutes((m) => m + VISIT_STEP_MIN)}
        />
        {seeCost ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <CostField id="stop-cost" value={cost} onChange={setCostValue} basis={basis} onBasis={setBasis} disabled={!setCost} />
            {cents ? (
              <span className="mono-data-sm" style={{ color: "var(--text-muted)", letterSpacing: 0 }}>
                {basis === "group"
                  ? `${formatMoney(cents)} ÷ ${people} = ${formatMoney(Math.round(cents / people))} each`
                  : `${formatMoney(cents)} × ${people} = ${formatMoney(cents * people)}`}
              </span>
            ) : null}
            {setCost ? (
              <span style={{ font: "400 11.5px var(--font-sans)", color: "var(--text-secondary)" }}>Saved to the idea, so it’s the same wherever it’s planned.</span>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <span role="alert" style={{ font: "500 12.5px var(--font-sans)", color: "var(--warn)" }}>
            {error}
          </span>
        ) : null}
        <div style={{ display: "flex", gap: 10 }}>
          <Button variant="secondary" fullWidth={false} onClick={onRemove} disabled={busy} style={{ padding: "0 16px", color: "var(--warn)" }}>
            Remove stop
          </Button>
          <Button onClick={done} disabled={busy}>
            {busy ? "Saving…" : "Done"}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
