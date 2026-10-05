import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePlannerDispatch, usePlannerState, useCan } from "../../state/PlannerContext";
import { api } from "../../lib/api";
import { outsideTrip } from "../../lib/tripWhen";

// Under the Plan tab's day strip, when there's something to say about the
// trip's days themselves (lib/tripWhen.js):
//
//   - a trip planned before its dates are known numbers its days from the
//     day you arrive, and the dates can be set any time;
//   - when the dates moved and things were kept on the dates they were on,
//     whatever ended up outside the trip is set aside, not deleted. It
//     comes back if the dates move back, or can be cleared here.
export default function TripDaysNotice() {
  const navigate = useNavigate();
  const dispatch = usePlannerDispatch();
  const { trip, plans, dayPlaces } = usePlannerState();
  const can = useCan();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const outside = outsideTrip({ plans, dayPlaces }, trip.dayCount);
  // A plan in a vote goes when the vote does; it isn't cleared from here.
  const clearable = outside.plans.filter((p) => !p.contestId);
  const settingsLink = can("trip:manage") ? () => navigate(`/trips/${trip.id}/trip-settings`) : null;

  async function clearOutside() {
    setBusy(true);
    setError("");
    try {
      for (const plan of clearable) await api.deletePlan(plan.id);
      if (outside.days.length) await api.putDayPlaces(trip.id, outside.days.map((day) => ({ day, stay: null, visits: [] })));
      await dispatch({ type: "REFRESH_PLANS_AND_ITEMS" });
      dispatch({ type: "APPLY_DAY_PLACES", days: Object.fromEntries(outside.days.map((day) => [day, null])) });
      setConfirming(false);
    } catch (err) {
      setError(err.message || "Couldn't clear them. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (outside.plans.length || outside.days.length) {
    const count = outside.plans.length;
    const parts = [
      count ? `${count} ${count === 1 ? "plan" : "plans"}` : null,
      outside.days.length ? `places for ${outside.days.length === 1 ? "a day" : `${outside.days.length} days`}` : null,
    ].filter(Boolean);
    const subject = parts.join(" and ");
    const one = parts.length === 1 && count === 1;
    const verb = one ? "is" : "are";
    return (
      <Notice tone="warn">
        <div style={{ font: "600 12.5px var(--font-sans)", color: "var(--warn)" }}>
          {subject[0].toUpperCase()}
          {subject.slice(1)} {verb} outside the trip’s days
        </div>
        <div>
          When the dates moved, {one ? "it was" : "they were"} kept on the dates {one ? "it was" : "they were"} on.
          Move the dates back to see {one ? "it" : "them"} again{can("plans:write") ? ", or clear " + (one ? "it" : "them") : ""}.
        </div>
        {error ? <div style={{ color: "var(--warn)" }}>{error}</div> : null}
        <div style={{ display: "flex", gap: 14 }}>
          {settingsLink ? <LinkButton onClick={settingsLink}>Trip settings ›</LinkButton> : null}
          {can("plans:write") ? (
            confirming ? (
              <LinkButton onClick={clearOutside} disabled={busy} warn>
                {busy ? "Clearing…" : `Clear ${one ? "it" : "them"}: ${one ? "its idea stays" : "their ideas stay"} on the board`}
              </LinkButton>
            ) : (
              <LinkButton onClick={() => setConfirming(true)}>{one ? "Clear it" : "Clear them"}</LinkButton>
            )
          ) : null}
        </div>
      </Notice>
    );
  }

  if (!trip.startDate && trip.dayCount) {
    return (
      <Notice>
        <div>
          <b style={{ color: "var(--text-primary)", fontWeight: 600 }}>No dates yet.</b> Days are counted from the day you arrive. When you set the
          dates, Day 1 becomes the first of them and the rest follow.
        </div>
        {settingsLink ? <LinkButton onClick={settingsLink}>Set dates ›</LinkButton> : null}
      </Notice>
    );
  }

  return null;
}

function Notice({ tone, children }) {
  const warn = tone === "warn";
  return (
    <div
      role="note"
      style={{
        margin: "0 var(--gutter-screen) 12px",
        padding: "9px 11px",
        borderRadius: "var(--radius-lg)",
        border: `1px dashed ${warn ? "var(--warn)" : "var(--border-strong)"}`,
        background: warn ? "rgba(180, 85, 63, 0.05)" : "var(--surface-inset)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        font: "400 11.5px/1.45 var(--font-sans)",
        color: "var(--text-secondary)",
      }}
    >
      {children}
    </div>
  );
}

function LinkButton({ onClick, disabled = false, warn = false, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{ alignSelf: "flex-start", font: "600 12px var(--font-sans)", color: warn ? "var(--warn)" : "var(--accent)", textAlign: "left" }}
    >
      {children}
    </button>
  );
}
