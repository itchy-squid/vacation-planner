import { useCallback, useEffect, useMemo, useState } from "react";
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
import TripWhenFields from "../components/trip/TripWhenFields";
import MoveDatesSheet from "../components/trip/MoveDatesSheet";
import Toast from "../components/core/Toast";
import { dayContents, lengthOf, movePreview, shortDate, startMovedBy, whenFields, whenOf } from "../lib/tripWhen";
import { dayRangeLabel } from "../lib/dayPlaces";

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
//
// When the trip is (components/trip/TripWhenFields.jsx, lib/tripWhen.js):
// its dates, or a length for planning before they're known. Moving the
// start date from one date to another with anything on the calendar asks
// first (components/trip/MoveDatesSheet.jsx) whether the plan moves with
// it, and stays on this screen afterwards with an Undo.
export default function TripSettings() {
  const can = useCan();
  if (!can("trip:manage")) return <TripInfo />;
  return <OwnerSettings />;
}

function OwnerSettings() {
  const navigate = useNavigate();
  const dispatch = usePlannerDispatch();
  const { trip, contributors, currentUserId, plans, splits, dayPlaces, pins } = usePlannerState();
  const [inviting, setInviting] = useState(false);
  const hideToast = useCallback(() => setToast(null), []);
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
  const [when, setWhen] = useState(() => whenOf(trip));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  // Open while asking whether the plan moves with new dates.
  const [askingMove, setAskingMove] = useState(false);
  // "Dates saved" with an Undo, after the plan moved (or didn't).
  const [toast, setToast] = useState(null);

  const canSubmit = name.trim().length > 0 && !submitting && (when.mode === "rough" || !when.endDate || !when.startDate || when.endDate >= when.startDate);
  const newStart = when.mode === "dates" ? when.startDate || null : null;
  const moved = startMovedBy(trip.startDate, newStart);
  const contents = useMemo(() => dayContents(plans, dayPlaces), [plans, dayPlaces]);
  const onCalendar = plans.length > 0 || splits.length > 0 || contents.size > 0 || Object.values(pins).some((p) => p.costStartDay != null);

  // Days with something on them that the new dates or length leave out,
  // when day 1 isn't moving (a moving start is the sheet's to explain).
  const newCount = when.mode === "rough" ? when.lengthDays : lengthOf(when.startDate, when.endDate);
  const cutDays = !moved && newCount ? [...contents.keys()].filter((d) => d > newCount && d <= (trip.dayCount ?? 0)).sort((a, b) => a - b) : [];

  async function save(move = null) {
    if (!canSubmit) return;
    const before = whenOf(trip);
    setSubmitting(true);
    setError(null);
    try {
      await dispatch({ type: "UPDATE_TRIP", fields: { name: name.trim(), ...whenFields(when), ...(move ? { move } : {}) } });
    } catch (err) {
      setSubmitting(false);
      // Someone else's draft counts as being on the calendar too, and
      // only the server can see it.
      if (err.status === 409 && err.body?.detail?.code === "move_required") {
        setAskingMove(true);
        return;
      }
      setError(err.body?.detail?.message || err.message || "Couldn't save those changes. Try again.");
      return;
    }
    setSubmitting(false);
    if (!move) {
      navigate(-1);
      return;
    }
    setAskingMove(false);
    const setAside =
      move === "keep_dates"
        ? movePreview({ contents, oldStart: trip.startDate, newStart: when.startDate, newLength: newCount, how: move }).setAside.reduce((n, d) => n + d.contents.plans, 0)
        : 0;
    setToast({
      message: move === "shift" ? "Dates saved · the plan moved with them" : setAside ? `Dates saved · ${setAside} ${setAside === 1 ? "plan" : "plans"} set aside` : "Dates saved",
      undo: { before, move },
    });
  }

  function handleSave() {
    if (moved && onCalendar) {
      setAskingMove(true);
      return;
    }
    save();
  }

  // Back to the dates from before the move, the same way: moving the
  // start back with "keep_dates" puts every day back where it was.
  async function undo() {
    const { before, move } = toast.undo;
    try {
      await dispatch({ type: "UPDATE_TRIP", fields: { ...whenFields(before), move } });
      setWhen(before);
    } catch (err) {
      setError(err.message || "Couldn't put the dates back.");
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
          <TripWhenFields value={when} onChange={setWhen} />
          {!trip.startDate && trip.dayCount && newStart ? (
            <div style={{ font: "400 12px/1.45 var(--font-sans)", color: "var(--text-secondary)", marginTop: -4 }}>
              Day 1 becomes {shortDate(newStart)}, and the other days follow in order.
            </div>
          ) : null}
          {cutDays.length ? (
            <div style={{ font: "400 12px/1.45 var(--font-sans)", color: "var(--warn)", marginTop: -4 }}>
              {dayRangeLabel(cutDays)} {cutDays.length === 1 ? "has" : "have"} things on {cutDays.length === 1 ? "it" : "them"}. They’ll be set aside, not deleted.
            </div>
          ) : null}

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
      {askingMove ? (
        <MoveDatesSheet
          before={{ startDate: trip.startDate, endDate: trip.endDate }}
          after={{ startDate: when.startDate, endDate: when.endDate }}
          plans={plans}
          dayPlaces={dayPlaces}
          saving={submitting}
          error={error}
          onSave={(move) => save(move)}
          onClose={() => setAskingMove(false)}
        />
      ) : null}
      <Toast message={toast?.message} actionLabel="Undo" onAction={toast ? undo : null} onDone={hideToast} />
    </div>
  );
}
