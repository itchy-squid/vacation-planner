import { useState } from "react";
import { useNavigate } from "react-router-dom";
import TextField from "../components/forms/TextField";
import Button from "../components/core/Button";
import HomeButton from "../components/core/HomeButton";
import { usePlannerDispatch } from "../state/PlannerContext";

// Not one of the handoff README's numbered screens — added so the "+"
// affordance on Trips Home (screen 1) does something. Mirrors EditVisit's
// full-screen form pattern (header row + stacked fields + a bottom
// primary button) rather than a modal, to stay consistent with how this
// app does every other editing flow.
export default function NewTrip() {
  const navigate = useNavigate();
  const dispatch = usePlannerDispatch();

  const [name, setName] = useState("");
  const [regionLine, setRegionLine] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const canSubmit = name.trim().length > 0 && !submitting;

  async function handleCreate() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await dispatch({
        type: "CREATE_TRIP",
        payload: {
          name: name.trim(),
          region_line: regionLine.trim(),
          start_date: startDate || null,
          end_date: endDate || null,
        },
      });
      navigate("/");
    } catch (err) {
      setError(err.message || "Couldn't create the trip. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="screen">
      <div className="screen-scroll" style={{ paddingBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 16px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <HomeButton size={28} />
            <button onClick={() => navigate("/")} style={{ font: "500 13px var(--font-sans)", color: "var(--accent)" }}>‹ Cancel</button>
          </div>
          <span className="mono-caption">New trip</span>
          <button
            onClick={handleCreate}
            disabled={!canSubmit}
            style={{ font: "600 13px var(--font-sans)", color: canSubmit ? "var(--text-primary)" : "var(--text-muted)" }}
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>

        <div style={{ padding: "16px 16px 0", display: "flex", flexDirection: "column", gap: 14 }}>
          <TextField
            label="Trip name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Peru"
            weight={600}
            size={15}
            autoFocus
          />
          <TextField
            label="Regions"
            value={regionLine}
            onChange={(e) => setRegionLine(e.target.value)}
            placeholder="e.g. Cusco · Sacred Valley · Lima"
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

          {error ? (
            <div style={{ font: "500 12.5px var(--font-sans)", color: "#b3423a" }}>{error}</div>
          ) : null}

          <Button variant="primary" onClick={handleCreate} disabled={!canSubmit} style={{ marginTop: 4 }}>
            {submitting ? "Creating…" : "Create trip"}
          </Button>
          <div style={{ textAlign: "center", font: "400 11px var(--font-sans)", color: "var(--text-muted)", paddingBottom: 8 }}>
            You’ll be the owner — invite others once it’s open.
          </div>
        </div>
      </div>
    </div>
  );
}
