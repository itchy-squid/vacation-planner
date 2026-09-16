import { useState } from "react";
import { useNavigate } from "react-router-dom";
import HomeButton from "../components/core/HomeButton";
import Button from "../components/core/Button";
import PeopleList, { Avatar } from "../components/sharing/PeopleList";
import { roleLabel, usePlannerDispatch, usePlannerState } from "../state/PlannerContext";

const ACCESS_COPY = {
  reader: "You can see ideas, the plan, votes and the itinerary.",
  contributor: "You can add ideas, plan days, propose blocks, vote and see expenses.",
};

// What the gear opens for anyone who isn't the trip's owner (see
// pages/TripSettings.jsx): who owns the trip, what you can do on it, who
// else is on it, and a way to take it off your list.
export default function TripInfo() {
  const navigate = useNavigate();
  const dispatch = usePlannerDispatch();
  const { trip, contributors, currentUserId } = usePlannerState();
  const [armed, setArmed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");

  const owner = contributors.find((c) => c.role === "owner") ?? trip.owner;
  const ownerName = owner?.name ?? "the owner";

  async function handleLeave() {
    if (!armed) {
      setArmed(true);
      return;
    }
    setLeaving(true);
    setError("");
    const result = await dispatch({ type: "LEAVE_TRIP" });
    if (result.ok) {
      navigate("/", { replace: true });
      return;
    }
    setLeaving(false);
    setArmed(false);
    setError(result.error || "Couldn't leave the trip. Try again.");
  }

  const travellers = trip.travellerCount ?? contributors.length;

  return (
    <div className="screen">
      <div className="screen-scroll" style={{ paddingBottom: 32 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "20px 16px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <HomeButton size={28} />
            <button onClick={() => navigate(-1)} style={{ font: "500 13px var(--font-sans)", color: "var(--accent)" }}>
              ‹ Back
            </button>
          </div>
          <span className="mono-caption">Trip info</span>
          <div />
        </div>

        <div style={{ padding: "16px 16px 0", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ padding: "0 4px" }}>
            <h1 className="serif-place" style={{ font: "var(--type-title)", color: "var(--text-primary)" }}>{trip.name}</h1>
            <div style={{ font: "var(--type-body)", color: "var(--text-secondary)", marginTop: 4 }}>
              {trip.dateLine} · {travellers} traveller{travellers === 1 ? "" : "s"}
            </div>
          </div>

          <span className="mono-caption" style={{ marginTop: 6 }}>Owner</span>
          <div
            style={{
              marginTop: -6,
              display: "flex",
              alignItems: "center",
              gap: 11,
              minHeight: 56,
              padding: "6px 14px",
              background: "var(--surface-card)",
              borderRadius: "var(--radius-xl)",
              border: "1px solid var(--hairline)",
            }}
          >
            <Avatar person={owner} />
            <div style={{ minWidth: 0 }}>
              <div style={{ font: "var(--type-label)", color: "var(--text-primary)" }}>{owner?.name ?? "Unknown"}</div>
              {owner?.email ? (
                <div style={{ font: "var(--type-body-sm)", color: "var(--text-secondary)" }}>{owner.email}</div>
              ) : null}
            </div>
          </div>

          <span className="mono-caption" style={{ marginTop: 6 }}>Your access</span>
          <div
            style={{
              marginTop: -6,
              padding: "14px 16px",
              background: "var(--surface-card)",
              borderRadius: "var(--radius-xl)",
              border: "1px solid var(--hairline)",
            }}
          >
            <div style={{ font: "var(--type-label)", color: "var(--text-primary)" }}>{roleLabel(trip.role)}</div>
            <div style={{ font: "var(--type-body-sm)", color: "var(--text-secondary)", marginTop: 3 }}>
              {ACCESS_COPY[trip.role] ?? ""} Ask {ownerName} if you need to change the trip&rsquo;s settings
              {trip.role === "reader" ? " or make changes" : ""}.
            </div>
          </div>

          <span className="mono-caption" style={{ marginTop: 6 }}>People · {contributors.length}</span>
          <div style={{ marginTop: -6 }}>
            <PeopleList contributors={contributors} currentUserId={currentUserId} />
          </div>

          <Button
            variant="secondary"
            onClick={handleLeave}
            onBlur={() => !leaving && setArmed(false)}
            disabled={leaving}
            style={{
              marginTop: 10,
              color: armed ? "#fff" : "var(--warn)",
              background: armed ? "var(--warn)" : "var(--surface-card)",
              border: armed ? "none" : "1px solid var(--border-strong)",
            }}
          >
            {leaving ? "Leaving…" : armed ? "Tap again to leave" : "Leave trip"}
          </Button>
          <div style={{ marginTop: -6, textAlign: "center", font: "var(--type-caption)", color: "var(--text-muted)" }}>
            Removes {trip.name} from your trips. You&rsquo;ll need a new link to rejoin.
          </div>
          {error ? <div style={{ font: "500 12.5px var(--font-sans)", color: "#b3423a" }}>{error}</div> : null}
        </div>
      </div>
    </div>
  );
}
