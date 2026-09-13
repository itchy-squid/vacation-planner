import { useNavigate } from "react-router-dom";
import PhotoPlaceholder from "../components/core/PhotoPlaceholder";
import Badge from "../components/core/Badge";
import Button from "../components/core/Button";
import AvatarStack from "../components/planner/AvatarStack";
import MetricTile from "../components/planner/MetricTile";
import { usePlannerState, usePlannerDispatch } from "../state/PlannerContext";
import { logout } from "../lib/api";

// Screen 1 — "pick a trip; read its phase at a glance." Handoff README
// screen 1. "Add trip" opens the new-trip form (see pages/NewTrip.jsx);
// tapping an "also planning" trip swaps it into the primary trip card
// (see PlannerContext's OPEN_TRIP) so its overview is visible before the
// user chooses "Open board" or "Start schedule"/"Open schedule" (label
// reflects TRIP.phase — "Start schedule" pre-ideation-exit, "Open
// schedule" once the trip has moved into scheduling/locked) — it does not
// navigate away from this screen.
export default function TripsHome() {
  const navigate = useNavigate();
  const dispatch = usePlannerDispatch();
  const {
    trip: TRIP,
    otherTrips: OTHER_TRIPS,
    contributors: allContributors,
    contributorOverflowCount,
    switchingTripId,
  } = usePlannerState();
  const CONTRIBUTORS = allContributors.slice(0, 4);
  const CONTRIBUTOR_OVERFLOW_COUNT = contributorOverflowCount;

  // Nothing in the database yet — a fresh install, or a new user who
  // hasn't started a trip (see PlannerContext's emptyTripView). Its own
  // screen rather than a blank version of the one below: with no trip
  // there is no primary card, no "also planning" list and no contributors
  // to stack, so all that's left is the one thing to do next.
  if (TRIP === null) {
    return <NoTripsYet onCreate={() => navigate("/new-trip")} />;
  }

  async function openTrip(tripId) {
    // Swaps this "also planning" trip into the primary card (OPEN_TRIP
    // re-derives both `trip` and `otherTrips`, so the former primary trip
    // reappears in the "also planning" list automatically). Deliberately
    // stays on this screen instead of navigating — the user sees the
    // swapped-in trip's overview here and picks "Open board" or "Start
    // schedule" themselves when ready.
    if (switchingTripId) return; // one switch at a time
    try {
      await dispatch({ type: "OPEN_TRIP", tripId });
    } catch (err) {
      console.error("open trip failed", err);
    }
  }

  return (
    <div className="screen">
      <div className="screen-scroll" style={{ paddingBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", padding: "20px var(--gutter-text) 14px" }}>
          <h1 style={{ font: "700 26px var(--font-sans)", color: "var(--text-primary)" }}>Trips</h1>
          <div style={{ display: "flex", gap: 8 }}>
            <CircleGlyph glyph="+" label="Add trip" onClick={() => navigate("/new-trip")} />
          </div>
        </div>

        <div style={{ padding: "0 var(--gutter-screen)" }}>
          <div
            style={{
              borderRadius: "var(--radius-2xl)",
              border: "1px solid var(--hairline)",
              boxShadow: "var(--shadow-raised)",
              background: "var(--surface-card)",
              overflow: "hidden",
            }}
          >
            <PhotoPlaceholder height={158} label="">
              <div style={{ position: "absolute", bottom: 10, right: 10 }}>
                <Badge>{TRIP.phase === "ideation" ? "IDEATION" : "SCHEDULING"}</Badge>
              </div>
            </PhotoPlaceholder>
            <div style={{ padding: "16px 18px 18px" }}>
              <div className="serif-place" style={{ fontSize: 27, lineHeight: 1.15, color: "var(--text-primary)" }}>{TRIP.name}</div>
              <div style={{ font: "400 13px var(--font-sans)", color: "var(--text-secondary)", marginTop: 4 }}>
                {TRIP.dateLine}
                {TRIP.locationsLine ? ` · ${TRIP.locationsLine}` : ""}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                <AvatarStack contributors={CONTRIBUTORS} overflowCount={CONTRIBUTOR_OVERFLOW_COUNT} />
                <span style={{ font: "400 12px var(--font-sans)", color: "var(--text-muted)" }}>{TRIP.contributorCount} planning</span>
              </div>

              <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
                <MetricTile value={TRIP.metrics.pins} label="pins" size={17} />
                <MetricTile value={TRIP.metrics.regions} label="regions" size={17} />
                <MetricTile value={TRIP.metrics.toDecide} label="to decide" size={17} />
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                <Button variant="primary" onClick={() => navigate(`/trips/${TRIP.id}/board`)}>Open board</Button>
                <Button variant="secondary" onClick={() => navigate(`/trips/${TRIP.id}/schedule/5`)}>
                  {TRIP.phase === "ideation" ? "Start schedule" : "Open schedule"}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Hidden rather than shown empty — with one trip (the common case
            right after creating the first one) there is nothing "also"
            about it. */}
        {OTHER_TRIPS.length > 0 ? (
          <div className="mono-caption" style={{ padding: "20px var(--gutter-text) 10px" }}>Also planning</div>
        ) : null}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 var(--gutter-screen)" }}>
          {OTHER_TRIPS.map((t) => {
            const isOpening = switchingTripId === t.id;
            return (
              <div
                key={t.id}
                role="button"
                tabIndex={0}
                aria-label={`Switch to ${t.name}`}
                onClick={() => openTrip(t.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openTrip(t.id);
                  }
                }}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  background: "var(--surface-card)",
                  borderRadius: "var(--radius-xl)",
                  border: "1px solid var(--hairline)",
                  padding: 10,
                  cursor: switchingTripId ? "default" : "pointer",
                  opacity: isOpening ? 0.6 : 1,
                }}
              >
                <PhotoPlaceholder height={56} label="" style={{ width: 56, flex: "none", borderRadius: "var(--radius-md)" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="serif-place" style={{ fontSize: 18, color: "var(--text-primary)" }}>{t.name}</div>
                  <div style={{ font: "400 12px var(--font-sans)", color: "var(--text-secondary)", marginTop: 2 }}>
                    {isOpening ? "Opening…" : t.meta}
                  </div>
                  <div style={{ marginTop: 6, width: 64, height: 5, borderRadius: 999, background: t.phase === "ideation" ? "var(--plum-tint-strong)" : "var(--surface-sunken)", overflow: "hidden" }}>
                    <div style={{ width: `${t.progress * 100}%`, height: "100%", background: t.phase === "ideation" ? "var(--accent)" : "var(--geo)" }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <SignOut />
      </div>
    </div>
  );
}

// Signing out used to live in the ☰ menu on the trip screens (see
// components/core/TripHeader.jsx, which replaced it with a back chevron and
// a gear). It belongs here instead: leaving the app is something you do
// when you're done with a trip, not mid-way through arranging one, and this
// is the only screen that isn't about a particular trip. Quiet on purpose —
// it's the rarest thing on the screen and the only irreversible one.
function SignOut() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "28px 0 4px" }}>
      <button
        type="button"
        className="tap hit-target"
        onClick={logout}
        style={{
          padding: "0 16px",
          background: "none",
          border: "none",
          font: "500 12.5px var(--font-sans)",
          color: "var(--text-muted)",
          cursor: "pointer",
        }}
      >
        Sign out
      </button>
    </div>
  );
}

// The no-trips screen. The header keeps only the title: with no trips
// there is nothing for a second, smaller "add" affordance to sit
// alongside, and the "New trip" button on the card below is the one
// obvious thing to do. The "+" returns to the header as soon as there is
// a first trip.
function NoTripsYet({ onCreate }) {
  return (
    <div className="screen">
      <div className="screen-scroll" style={{ paddingBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "flex-end", padding: "20px var(--gutter-text) 14px" }}>
          <h1 style={{ font: "700 26px var(--font-sans)", color: "var(--text-primary)" }}>Trips</h1>
        </div>

        <div style={{ padding: "0 var(--gutter-screen)" }}>
          <div
            style={{
              borderRadius: "var(--radius-2xl)",
              border: "1px dashed var(--border-strong)",
              background: "var(--surface-card)",
              padding: "36px 22px",
              textAlign: "center",
            }}
          >
            <div className="serif-place" style={{ fontSize: 23, lineHeight: 1.2, color: "var(--text-primary)" }}>
              No trips yet
            </div>
            <div
              style={{
                font: "400 13px var(--font-sans)",
                color: "var(--text-secondary)",
                marginTop: 8,
                maxWidth: 268,
                marginInline: "auto",
              }}
            >
              Create a new trip to get started.
            </div>
            <div style={{ display: "flex", justifyContent: "center", marginTop: 20 }}>
              <Button variant="primary" fullWidth={false} onClick={onCreate} style={{ padding: "0 24px" }}>
                New trip
              </Button>
            </div>
          </div>
        </div>

        <SignOut />
      </div>
    </div>
  );
}

function CircleGlyph({ glyph, label, onClick }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{
        width: 36,
        height: 36,
        borderRadius: "50%",
        background: "var(--surface-card)",
        border: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        font: "400 16px var(--font-sans)",
        color: "var(--text-primary)",
      }}
    >
      {glyph}
    </button>
  );
}
