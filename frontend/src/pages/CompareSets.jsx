import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import MapPlaceholder from "../components/planner/MapPlaceholder";
import MapPin from "../components/planner/MapPin";
import RouteSegment from "../components/planner/RouteSegment";
import SetCard from "../components/planner/SetCard";
import ConsensusMeter from "../components/planner/ConsensusMeter";
import { usePlannerState, usePlannerDispatch, useCurrentUser } from "../state/PlannerContext";
import HomeButton from "../components/core/HomeButton";
import { fmtMin, clock, slackColor, sequenceStops, draftSetTotals } from "../data/derive";

// Presentation-only pacing between consecutive stops on the map/timeline —
// the backend gives us each set's totals (backend/app/derive.py) but not
// per-stop start times, so those are still sequenced client-side, same as
// the original mock's STOP_GAP_MIN.
const STOP_GAP_MIN = { A: 10, B: 6, C: 12 };
const DRAFT_COLOR = "#6f7f3c";

// Screen 5 — "the core screen." Decide one block by comparing sets of
// places on a single map. See handoff README screen 5 and "Interactions &
// behaviour": selecting a set drives which pins are large/coloured/
// numbered/labelled, which routes exist, and which card expands — nothing
// else moves. Sets A/B, their stops, totals, and votes are now the real
// Day 5 Block from the backend (see state/PlannerContext.jsx); "Set C" is
// still a local, unpersisted draft — the backend has no endpoint yet to
// create or edit a draft CandidateSet (see backend/app/models.py).
export default function CompareSets() {
  const navigate = useNavigate();
  const state = usePlannerState();
  const dispatch = usePlannerDispatch();
  const currentUser = useCurrentUser();
  const { trip, day5Block, pins, draft, selectedSet, myVoteC } = state;

  const claimedIds = useMemo(
    () => new Set(day5Block ? day5Block.candidateSets.flatMap((s) => s.stopPinIds) : []),
    [day5Block]
  );
  const poolPins = useMemo(
    () => (day5Block ? Object.values(pins).filter((p) => p.region === day5Block.region && !claimedIds.has(p.id)) : []),
    [pins, day5Block, claimedIds]
  );
  const allCandidatePinIds = useMemo(() => [...claimedIds, ...poolPins.map((p) => p.id)], [claimedIds, poolPins]);

  const draftTotals = useMemo(
    () => draftSetTotals(pins, draft, day5Block ? day5Block.end - day5Block.start : 0),
    [pins, draft, day5Block]
  );
  const draftPins = draftTotals.stops;

  const displaySets = useMemo(() => {
    if (!day5Block) return [];
    const real = day5Block.candidateSets.map((s) => ({
      key: s.key,
      id: s.id,
      color: s.color,
      cost: Math.round(s.totalCostCents / 100),
      moving: s.movingMinutes,
      slack: s.slackMinutes,
      stopPins: s.stopPinIds.map((id) => pins[id]).filter(Boolean),
      votes: s.voteCount,
      voted: s.id === day5Block.myVoteCandidateSetId,
    }));
    if (draft.length) {
      real.push({
        key: "C",
        id: null,
        color: DRAFT_COLOR,
        cost: draftTotals.cost,
        moving: draftTotals.moving,
        slack: draftTotals.slack,
        stopPins: draftPins,
        votes: myVoteC ? 1 : 0,
        voted: myVoteC,
      });
    }
    return real;
  }, [day5Block, pins, draft.length, draftPins, draftTotals, myVoteC]);

  const leadingKey = useMemo(
    () => displaySets.reduce((best, s) => (best == null || s.votes > (best.votes ?? -1) ? s : best), null)?.key ?? null,
    [displaySets]
  );

  const selectedSetView = displaySets.find((s) => s.key === selectedSet);
  const selectedStopPins = selectedSetView?.stopPins ?? [];
  const selectedColor = selectedSetView?.color ?? "var(--accent)";
  const selectedTimes = day5Block
    ? sequenceStops(selectedStopPins, day5Block.start, STOP_GAP_MIN[selectedSet] ?? 12)
    : [];

  const votedCount = day5Block ? day5Block.votedCount + (myVoteC && !day5Block.myVoteCandidateSetId ? 1 : 0) : 0;

  function openEdit(pinId) {
    navigate(`/trips/${trip.id}/edit/${pinId}?from=compare`);
  }

  function handleLock(key) {
    dispatch({ type: "LOCK_SET", key });
    navigate(`/trips/${trip.id}/schedule/5`);
  }

  if (!day5Block) {
    return (
      <div className="screen" style={{ padding: 24 }}>
        <p>No contested block to compare yet.</p>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="screen-scroll">
        <div style={{ position: "relative", height: 376 }}>
          <MapPlaceholder height="100%">
            <div style={{ position: "absolute", top: 58, left: 16, right: 16, display: "flex", alignItems: "center", gap: 10, zIndex: 5 }}>
              <button
                className="tap"
                onClick={() => navigate(`/trips/${trip.id}/schedule/5`)}
                style={{ width: 38, height: 38, borderRadius: 11, background: "rgba(255,255,255,.95)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", font: "400 16px var(--font-sans)", color: "var(--text-primary)" }}
              >
                ‹
              </button>
              <HomeButton style={{ width: 38, height: 38, background: "rgba(255,255,255,.95)" }} />
              <div style={{ flex: 1, background: "rgba(255,255,255,.95)", border: "1px solid var(--border)", borderRadius: 11, padding: "7px 12px" }}>
                <div className="mono-data-sm" style={{ color: "var(--text-muted)" }}>
                  DAY {day5Block.dayIndex} · {clock(day5Block.start)}–{clock(day5Block.end)}
                </div>
                <div style={{ font: "600 12.5px var(--font-sans)", color: "var(--text-primary)", marginTop: 1 }}>
                  {allCandidatePinIds.length} pins want this block
                </div>
              </div>
            </div>

            {selectedTimes.slice(1).map((stop, i) => (
              <RouteSegment key={stop.pin.id} from={selectedTimes[i].pin} to={stop.pin} color={selectedColor} />
            ))}

            {allCandidatePinIds.map((id) => {
              const pin = pins[id];
              if (!pin) return null;
              const inSelected = selectedStopPins.some((p) => p.id === id);
              const order = inSelected ? selectedStopPins.findIndex((p) => p.id === id) + 1 : null;
              return (
                <MapPin
                  key={id}
                  cx={pin.cx}
                  cy={pin.cy}
                  selected={inSelected}
                  order={order}
                  color={selectedColor}
                  label={pin.short}
                  flipLabel={pin.cx > 230}
                  onTap={() => openEdit(id)}
                />
              );
            })}
          </MapPlaceholder>
        </div>

        <div style={{ background: "var(--surface-card)", borderRadius: "20px 20px 0 0", marginTop: -20, position: "relative", padding: "14px 16px 20px", boxShadow: "var(--shadow-sheet)" }}>
          <div style={{ width: 38, height: 4, borderRadius: 99, background: "var(--stone-250)", margin: "0 auto 14px" }} />
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <div className="serif-place" style={{ fontSize: 21, color: "var(--text-primary)" }}>Candidate sets</div>
            <div className="mono-data" style={{ color: "var(--text-muted)" }}>{fmtMin(day5Block.end - day5Block.start)} block</div>
          </div>

          <div style={{ marginTop: 13, display: "flex", flexDirection: "column", gap: 9 }}>
            {displaySets.map((s) => {
              const stops = sequenceStops(s.stopPins, day5Block.start, STOP_GAP_MIN[s.key] ?? 12).map((x) => ({
                id: x.pin.id,
                title: x.pin.title,
                meta: `${clock(x.start)}–${clock(x.end)} · ${fmtMin(x.pin.dur)} · $${x.pin.cost}`,
              }));
              return (
                <SetCard
                  key={s.key}
                  setKey={s.key}
                  color={s.color}
                  name={s.key === "C" ? "Set C · your draft" : `Set ${s.key} · ${s.stopPins.length} stop${s.stopPins.length === 1 ? "" : "s"}`}
                  sub={s.stopPins.map((p) => p.short).join(" → ") || "add pins below"}
                  isLeading={s.key === leadingKey && s.votes > 0}
                  votes={s.votes}
                  cost={s.cost}
                  moving={s.moving}
                  slack={s.slack}
                  slackColor={slackColor(s.slack)}
                  selected={selectedSet === s.key}
                  onSelect={() => dispatch({ type: "SELECT_SET", key: s.key })}
                  stops={stops}
                  onEditStop={openEdit}
                  voted={s.voted}
                  onVote={() => dispatch({ type: "TOGGLE_VOTE", key: s.key })}
                  onLock={() => handleLock(s.key)}
                  isOwner={currentUser.isOwner}
                />
              );
            })}
          </div>

          <div style={{ marginTop: 14, background: "var(--surface-sunken)", borderRadius: "var(--radius-xl)", padding: "12px 13px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <span className="mono-caption">{draft.length ? "In your Set C draft" : "Not in any set yet"}</span>
              <span style={{ font: "400 10.5px var(--font-sans)", color: "var(--text-muted)" }}>tap to add</span>
            </div>
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {poolPins.map((pin) => {
                const inDraft = draft.includes(pin.id);
                return (
                  <button
                    key={pin.id}
                    onClick={() => dispatch({ type: "TOGGLE_POOL_PIN", id: pin.id })}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 999,
                      font: "500 12px var(--font-sans)",
                      background: inDraft ? "var(--draft)" : "#fff",
                      color: inDraft ? "#fff" : "var(--text-primary)",
                      border: inDraft ? "none" : "1px solid var(--border)",
                    }}
                  >
                    {pin.short} · {fmtMin(pin.dur)}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <ConsensusMeter votedCount={votedCount} totalCount={day5Block.contributorCount} />
          </div>
          <div style={{ marginTop: 8, font: "400 11px var(--font-sans)", lineHeight: 1.5, color: "var(--text-muted)" }}>
            Selecting a set highlights that set&rsquo;s pins and draws its route on the map above. Nothing else moves.
          </div>
        </div>
      </div>
    </div>
  );
}
