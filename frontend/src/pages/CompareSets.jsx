import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import MapPlaceholder from "../components/planner/MapPlaceholder";
import MapPin from "../components/planner/MapPin";
import RouteSegment from "../components/planner/RouteSegment";
import SetCard from "../components/planner/SetCard";
import ConsensusMeter from "../components/planner/ConsensusMeter";
import { usePlannerState, usePlannerDispatch, useCurrentUser } from "../state/PlannerContext";
import { api } from "../lib/api";
import TripHeader from "../components/core/TripHeader";
import { fmtMin, slackColor } from "../data/derive";
import { clockLabel } from "../lib/planTime";
import { coordsForPin } from "../lib/mapLayout";

// Screen 5, rebuilt against the spec's Contest/Plan model. Handoff README
// screen 5's "select a set → highlight its pins + route, nothing else
// moves" interaction is unchanged; what changed is the data source and
// scope — this is now a real /contests/:contestId screen (any day can
// open one, not just Day 5 — see docs/features/scheduling-feature-
// spec.md "Voting" / "Locking" / "Reopening"), and there's no more local
// "Set C" draft: the backend has a real propose-alternative endpoint now
// (routers/contests.py propose_alternative), so every competing plan here
// is a real, persisted Plan. Vote tallies and "did I vote for this" are
// fetched fresh via api.getContest() on mount and after every vote/lock/
// reopen, rather than normalized into the global PlannerContext store —
// see state/PlannerContext.jsx's header comment for why.
//
// Stop times are no longer sequenced here. They come from each item's
// start_minute_of_day, computed once on the server (backend/app/derive.py)
// — this screen used to space stops 10 minutes apart while the itinerary
// screen used 12 and the backend subtracted another 12 from slack, so the
// same three-stop set read differently depending where you looked at it.
export default function CompareSets() {
  const navigate = useNavigate();
  const { contestId } = useParams();
  const state = usePlannerState();
  const dispatch = usePlannerDispatch();
  const currentUser = useCurrentUser();
  const { trip } = state;

  const [contest, setContest] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [selectedPlanId, setSelectedPlanId] = useState(null);
  const [busy, setBusy] = useState(false);

  const refetch = useCallback(async () => {
    try {
      const c = await api.getContest(contestId);
      setContest(c);
      setLoadError(null);
      setSelectedPlanId((prev) => (prev && c.plans.some((p) => p.id === prev) ? prev : c.plans[0]?.id ?? null));
    } catch (err) {
      setLoadError(err.message || String(err));
    }
  }, [contestId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const displaySets = useMemo(() => {
    if (!contest) return [];
    return contest.plans.map((p) => {
      const stops = [...p.items]
        .sort((a, b) => a.position - b.position)
        .map((it) => {
          const isPin = Boolean(it.pin);
          const src = isPin ? it.pin : it.travel_item;
          // The placement's own duration if it was trimmed, the item's
          // otherwise — the same resolution the server uses for totals.
          const duration = it.duration_minutes ?? src.duration_minutes;
          const start = it.start_minute_of_day;
          return {
            id: `${isPin ? "pin" : "travel"}-${src.id}`,
            title: src.title,
            meta: `${clockLabel(start)}–${clockLabel(start + duration)} · ${fmtMin(duration)}${
              src.cost_cents ? ` · $${Math.round(src.cost_cents / 100)}` : ""
            }`,
            isPin,
            pin: isPin ? src : null,
          };
        });
      return {
        id: p.id,
        color: p.color,
        label: p.label,
        setLetter: p.set_letter,
        rationale: p.rationale,
        status: p.status,
        cost: Math.round(p.total_cost_cents / 100),
        slack: p.slack_minutes,
        votes: p.vote_count,
        voted: p.voted_by_me,
        stops,
      };
    });
  }, [contest]);

  // Every option spans the contest's window, so the hours under decision
  // are the contest's own — not something to re-read off whichever plan
  // happens to be selected.
  const windowLabel = contest
    ? `${clockLabel(minuteOfDay(contest.starts_at))}–${clockLabel(minuteOfDay(contest.ends_at))}`
    : "";

  const leadingId = useMemo(
    () => displaySets.reduce((best, s) => (best == null || s.votes > (best.votes ?? -1) ? s : best), null)?.id ?? null,
    [displaySets]
  );

  const owner = state.contributors.find((c) => c.isOwner);
  const selectedSetView = displaySets.find((s) => s.id === selectedPlanId);
  const selectedColor = selectedSetView?.color ?? "var(--accent)";
  const selectedMapStops = (selectedSetView?.stops ?? []).filter((s) => s.isPin);

  const allMapStops = useMemo(() => {
    const seen = new Map();
    displaySets.forEach((s) => s.stops.forEach((stop) => {
      if (stop.isPin && !seen.has(stop.pin.id)) seen.set(stop.pin.id, stop.pin);
    }));
    return [...seen.values()];
  }, [displaySets]);

  function openEdit(stop) {
    if (!stop.isPin) return;
    navigate(`/trips/${trip.id}/edit/${stop.pin.id}?from=compare`);
  }

  async function handleVote(planId) {
    if (busy) return;
    setBusy(true);
    try {
      await api.toggleContestVote(contestId, planId);
      await refetch();
    } finally {
      setBusy(false);
    }
  }

  async function handleLock(planId) {
    if (busy) return;
    setBusy(true);
    try {
      await api.lockContest(contestId, planId);
      await refetch();
      await dispatch({ type: "REFRESH_PLANS_AND_ITEMS" });
    } finally {
      setBusy(false);
    }
  }

  async function handleReopen(planId) {
    if (busy) return;
    setBusy(true);
    try {
      await api.reopenPlan(planId);
      await refetch();
      await dispatch({ type: "REFRESH_PLANS_AND_ITEMS" });
    } finally {
      setBusy(false);
    }
  }

  function backToSchedule() {
    const dayIndex = contest ? dayIndexOf(contest.starts_at, trip.startDate) : 1;
    navigate(`/trips/${trip.id}/schedule/${dayIndex}`);
  }

  if (loadError) {
    return (
      <div className="screen" style={{ padding: 24 }}>
        <p>Couldn&rsquo;t load this contest — {loadError}</p>
        <button onClick={() => navigate(`/trips/${trip.id}/schedule/1`)}>‹ Back to schedule</button>
      </div>
    );
  }
  if (!contest) {
    return (
      <div className="screen" style={{ padding: 24 }}>
        <p>Loading contest…</p>
      </div>
    );
  }

  const votedCount = contest.voted_count;
  const isResolved = contest.status === "resolved";

  return (
    <div className="screen">
      <div className="screen-scroll">
        <div style={{ position: "relative", height: 376 }}>
          <MapPlaceholder height="100%">
            {/* Same floating treatment as the map screen's controls — the
                map runs to the top edge here too. */}
            <div style={{ position: "absolute", top: 16, left: 16, right: 16, zIndex: 5 }}>
              <TripHeader floating />
            </div>

            <div style={{ position: "absolute", top: 74, left: 16, right: 16, display: "flex", alignItems: "center", gap: 10, zIndex: 5 }}>
              <div style={{ flex: 1, background: "rgba(255,255,255,.95)", border: "1px solid var(--border)", borderRadius: 11, padding: "7px 12px" }}>
                <div className="mono-data-sm" style={{ color: "var(--text-muted)" }}>
                  {isResolved ? "LOCKED" : `${displaySets.length} option${displaySets.length === 1 ? "" : "s"}`}
                </div>
                <div style={{ font: "600 12.5px var(--font-sans)", color: "var(--text-primary)", marginTop: 1 }}>
                  {windowLabel}
                </div>
              </div>
              {/* The header's back goes to Trips Home, and the tab bar's
                  Schedule goes to day 1 — neither lands back on the day this
                  contest is about, which is where you came from. */}
              <button
                className="tap hit-target"
                onClick={backToSchedule}
                style={{ flex: "none", padding: "0 12px", height: "var(--hit-min)", borderRadius: 11, background: "rgba(255,255,255,.95)", border: "1px solid var(--border)", font: "600 12.5px var(--font-sans)", color: "var(--text-primary)" }}
              >
                ‹ Schedule
              </button>
            </div>

            {selectedMapStops.slice(1).map((stop, i) => (
              <RouteSegment key={stop.id} from={coordsForPin(selectedMapStops[i].pin)} to={coordsForPin(stop.pin)} color={selectedColor} />
            ))}

            {allMapStops.map((pin) => {
              const inSelected = selectedMapStops.some((s) => s.pin.id === pin.id);
              const order = inSelected ? selectedMapStops.findIndex((s) => s.pin.id === pin.id) + 1 : null;
              const { cx, cy } = coordsForPin(pin);
              return (
                <MapPin
                  key={pin.id}
                  cx={cx}
                  cy={cy}
                  selected={inSelected}
                  order={order}
                  color={selectedColor}
                  label={pin.title}
                  flipLabel={cx > 230}
                  onTap={() => openEdit({ isPin: true, pin })}
                />
              );
            })}
          </MapPlaceholder>
        </div>

        <div style={{ background: "var(--surface-card)", borderRadius: "20px 20px 0 0", marginTop: -20, position: "relative", padding: "14px 16px 20px", boxShadow: "var(--shadow-sheet)" }}>
          <div style={{ width: 38, height: 4, borderRadius: 99, background: "var(--stone-250)", margin: "0 auto 14px" }} />
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <div className="serif-place" style={{ fontSize: 21, color: "var(--text-primary)" }}>
              {isResolved ? "Locked plan" : "Candidate plans"}
            </div>
          </div>

          <div style={{ marginTop: 13, display: "flex", flexDirection: "column", gap: 9 }}>
            {displaySets.map((s) => (
              <SetCard
                key={s.id}
                setKey={s.id}
                color={s.color}
                name={s.label || `${s.stops.length} stop${s.stops.length === 1 ? "" : "s"}`}
                setLetter={s.setLetter}
                sub={s.stops.map((x) => x.title).join(" → ") || "no stops"}
                isLeading={s.id === leadingId && s.votes > 0 && !isResolved}
                isMajority={s.id === contest.majority_plan_id && !isResolved}
                rationale={s.rationale}
                votes={s.votes}
                cost={s.cost}
                slack={s.slack}
                slackColor={slackColor(s.slack)}
                selected={selectedPlanId === s.id}
                onSelect={() => setSelectedPlanId(s.id)}
                stops={s.stops}
                onEditStop={(stopId) => {
                  const stop = s.stops.find((x) => x.id === stopId);
                  if (stop) openEdit(stop);
                }}
                voted={s.voted}
                onVote={() => handleVote(s.id)}
                onLock={() => handleLock(s.id)}
                isOwner={currentUser.isOwner && !isResolved}
                ownerName={owner?.name}
              />
            ))}
          </div>

          {isResolved ? (
            <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
              {currentUser.isOwner && (
                <button
                  type="button"
                  onClick={() => handleReopen(contest.plans[0]?.id)}
                  disabled={busy}
                  style={{ font: "600 12px var(--font-sans)", color: "var(--accent)" }}
                >
                  Reopen this decision
                </button>
              )}
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              <ConsensusMeter votedCount={votedCount} totalCount={contest.contributor_count} />
            </div>
          )}
          <div style={{ marginTop: 8, font: "400 11px var(--font-sans)", lineHeight: 1.5, color: "var(--text-muted)" }}>
            {isResolved
              ? "This decision is locked. Reopening removes the lock but does not bring back the other option — it would need to be proposed again."
              : contest.majority_plan_id
              ? `More than half the group has picked a set. Nothing changes until ${
                  owner?.name ? `${owner.name} locks it in` : "the trip owner locks it in"
                }.`
              : "Selecting a plan highlights its pins and draws its route on the map above. Nothing else moves."}
          </div>
        </div>
      </div>
    </div>
  );
}

function minuteOfDay(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

function dayIndexOf(iso, startDate) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!dm || !startDate) return 1;
  const start = /^(\d{4})-(\d{2})-(\d{2})/.exec(startDate);
  if (!start) return 1;
  const dUTC = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]));
  const sUTC = Date.UTC(Number(start[1]), Number(start[2]) - 1, Number(start[3]));
  return Math.round((dUTC - sUTC) / 86400000) + 1;
}

