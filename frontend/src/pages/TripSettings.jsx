import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import TextField from "../components/forms/TextField";
import Button from "../components/core/Button";
import HomeButton from "../components/core/HomeButton";
import { usePlannerState, usePlannerDispatch, useCan } from "../state/PlannerContext";
import { api } from "../lib/api";
import PeopleList from "../components/sharing/PeopleList";
import InviteLinks from "../components/sharing/InviteLinks";
import InviteSheet from "../components/sharing/InviteSheet";
import { LinkIcon } from "../components/sharing/icons";
import TripInfo from "./TripInfo";
import TravelerRoster from "../components/travelers/TravelerRoster";

// Not one of the handoff README's numbered screens. Reachable from any of
// the trip's main screens via the gear in components/core/TripHeader.jsx.
// Only edits the currently-active
// trip — there's no flow
// yet for editing a trip you haven't opened (see PlannerContext's
// OPEN_TRIP for what "active" means). Mirrors NewTrip.jsx's fields since
// this is the same data, just after creation instead of before.
//
// Owner only. The gear takes everyone else to a read-only Trip info page
// (pages/TripInfo.jsx) instead: same route, since the gear doesn't know
// or care which one you get.
//
// People and invite links apply immediately — they're not part of the
// form's Save, which only covers the trip's own fields above them.
export default function TripSettings() {
  const can = useCan();
  if (!can("trip:manage")) return <TripInfo />;
  return <OwnerSettings />;
}

function OwnerSettings() {
  const navigate = useNavigate();
  const dispatch = usePlannerDispatch();
  const { trip, contributors, currentUserId } = usePlannerState();
  const [inviting, setInviting] = useState(false);
  const [invites, setInvites] = useState([]);

  const loadInvites = useCallback(() => {
    api
      .listInvites(trip.id)
      .then(setInvites)
      .catch((err) => console.error("list invites failed", err));
  }, [trip.id]);

  useEffect(() => {
    loadInvites();
  }, [loadInvites]);

  const [name, setName] = useState(trip.name);
  const [startDate, setStartDate] = useState(trip.startDate || "");
  const [endDate, setEndDate] = useState(trip.endDate || "");
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

          {error ? (
            <div style={{ font: "500 12.5px var(--font-sans)", color: "#b3423a" }}>{error}</div>
          ) : null}

          <Button variant="primary" onClick={handleSave} disabled={!canSubmit} style={{ marginTop: 4 }}>
            {submitting ? "Saving…" : "Save changes"}
          </Button>

          {/* Who is going — applies immediately, like People below; not
              part of Save. Replaces the old Travellers number: the count is
              now simply how many people are listed. */}
          <div style={{ marginTop: 18 }}>
            <TravelerRoster />
          </div>

          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 18 }}>
            <span className="mono-caption">People on the app · {contributors.length}</span>
            <span style={{ font: "var(--type-caption)", color: "var(--text-muted)" }}>Tap a role to change it</span>
          </div>
          <div style={{ marginTop: -6 }}>
            <PeopleList contributors={contributors} currentUserId={currentUserId} editable />
          </div>
          <Button variant="secondary" onClick={() => setInviting(true)}>
            <LinkIcon />
            Invite people
          </Button>

          {invites.length ? (
            <>
              <span className="mono-caption" style={{ marginTop: 14 }}>
                Invite links · {invites.length} active
              </span>
              <div style={{ marginTop: -6 }}>
                <InviteLinks tripId={trip.id} invites={invites} onChanged={loadInvites} />
              </div>
              <div style={{ marginTop: -6, font: "var(--type-caption)", color: "var(--text-muted)" }}>
                Anyone signed in with a link can join until you revoke it. Revoking a link doesn&rsquo;t remove
                people who already joined.
              </div>
            </>
          ) : null}
        </div>
      </div>
      {inviting ? <InviteSheet trip={trip} onClose={() => setInviting(false)} onLinksChanged={loadInvites} /> : null}
    </div>
  );
}
