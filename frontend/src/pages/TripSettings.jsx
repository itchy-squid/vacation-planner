import { useState } from "react";
import { useNavigate } from "react-router-dom";
import TextField from "../components/forms/TextField";
import Button from "../components/core/Button";
import HomeButton from "../components/core/HomeButton";
import { usePlannerState, usePlannerDispatch } from "../state/PlannerContext";

// Not one of the handoff README's numbered screens. Reachable from any of
// the trip's main screens via the gear in components/core/TripHeader.jsx.
// Only edits the currently-active
// trip — there's no flow
// yet for editing a trip you haven't opened (see PlannerContext's
// OPEN_TRIP for what "active" means). Mirrors NewTrip.jsx's fields since
// this is the same data, just after creation instead of before.
export default function TripSettings() {
  const navigate = useNavigate();
  const dispatch = usePlannerDispatch();
  const { trip, contributors } = usePlannerState();

  const [name, setName] = useState(trip.name);
  const [startDate, setStartDate] = useState(trip.startDate || "");
  const [endDate, setEndDate] = useState(trip.endDate || "");
  // Blank means "as many as there are contributors" — the Expenses screen
  // reads it that way too (see data/expenses.js headcountFor), so an empty
  // field is a real answer rather than an unset one.
  const [travellerCount, setTravellerCount] = useState(
    trip.travellerCount == null ? "" : String(trip.travellerCount)
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const canSubmit = name.trim().length > 0 && !submitting;

  async function handleSave() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await dispatch({
        type: "UPDATE_TRIP",
        fields: {
          name: name.trim(),
          start_date: startDate || null,
          end_date: endDate || null,
          traveller_count: travellerCount.trim() === "" ? null : Math.max(1, Number(travellerCount)),
        },
      });
      navigate(-1);
    } catch (err) {
      setError(err.message || "Couldn't save those changes. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="screen">
      <div className="screen-scroll" style={{ paddingBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 16px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <HomeButton size={28} />
            <button onClick={() => navigate(-1)} style={{ font: "500 13px var(--font-sans)", color: "var(--accent)" }}>‹ Cancel</button>
          </div>
          <span className="mono-caption">Trip settings</span>
          <button
            onClick={handleSave}
            disabled={!canSubmit}
            style={{ font: "600 13px var(--font-sans)", color: canSubmit ? "var(--text-primary)" : "var(--text-muted)" }}
          >
            {submitting ? "Saving…" : "Save"}
          </button>
        </div>

        <div style={{ padding: "16px 16px 0", display: "flex", flexDirection: "column", gap: 14 }}>
          <TextField
            label="Trip name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            weight={600}
            size={15}
          />
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <TextField
                type="date"
                label="Start date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <TextField
                type="date"
                label="End date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate || undefined}
              />
            </div>
          </div>

          <div>
            <TextField
              type="number"
              label="Travellers"
              value={travellerCount}
              onChange={(e) => setTravellerCount(e.target.value)}
              placeholder={String(contributors.length)}
              min={1}
            />
            <div style={{ marginTop: 6, font: "400 11px var(--font-sans)", color: "var(--text-muted)" }}>
              {/* Not the same as the number of people planning: a child
                  along for the ride is a head the tickets are bought for
                  and never a contributor (feature spec decision 9). */}
              How many people costs are split between. Leave it blank to use the {contributors.length}{" "}
              {contributors.length === 1 ? "person" : "people"} planning this trip.
            </div>
          </div>

          {error ? (
            <div style={{ font: "500 12.5px var(--font-sans)", color: "#b3423a" }}>{error}</div>
          ) : null}

          <Button variant="primary" onClick={handleSave} disabled={!canSubmit} style={{ marginTop: 4 }}>
            {submitting ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
