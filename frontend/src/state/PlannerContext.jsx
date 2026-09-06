import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { api } from "../lib/api";
import { coordsForPin } from "../lib/mapLayout";
import { formatDateRange, relativeTime } from "../lib/format";

// Client-side state, now sourced from the real FastAPI + Postgres backend
// (see root README "Next steps" — this is that next pass). Trip,
// contributors, pins, and Day 5's contested block all come from the API on
// mount; only two things stay purely local, because the backend has
// nothing to persist them to yet:
//   - "Set C", the current user's in-progress draft grouping (the schema
//     supports draft CandidateSet rows, but no endpoint creates/edits one
//     yet — see backend/app/models.py CandidateSet.is_draft)
//   - the decorative days (1-4, 6-8) and their placed/pencilled blocks,
//     which were always flavor content, not modeled in the backend at all
//     (see frontend/src/data/schedule.js)

function normalizeContributor(c) {
  return { id: c.id, name: c.display_name, initial: c.initial, tint: c.tint, isOwner: c.is_owner, email: c.email };
}

function normalizePin(p, contributorsById) {
  const addedBy = p.added_by_id ? contributorsById[p.added_by_id] : null;
  const { cx, cy } = coordsForPin(p);
  return {
    id: p.id,
    title: p.title,
    short: p.short,
    place: p.place,
    region: p.region,
    coords: p.lat != null && p.lng != null ? `${p.lat.toFixed(4)}° N, ${p.lng.toFixed(4)}° E` : "",
    cx,
    cy,
    dur: p.duration_minutes,
    cost: Math.round(p.cost_cents / 100),
    who: addedBy?.id ?? null,
    whoName: addedBy?.name ?? "Someone",
    addedAgo: relativeTime(p.added_at),
    notes: p.notes,
    link: p.link,
    tags: p.tags,
    availabilityRule: p.availability_rule
      ? { days: p.availability_rule.days, bands: p.availability_rule.bands, why: p.availability_rule.reasons }
      : { days: null, bands: null, why: [] },
  };
}

function normalizeBlock(b) {
  return {
    id: b.id,
    tripId: b.trip_id,
    dayIndex: b.day_index,
    start: b.start_minute,
    end: b.end_minute,
    region: b.region,
    status: b.status,
    lockedSetId: b.locked_set_id,
    votedCount: b.voted_count,
    contributorCount: b.contributor_count,
    myVoteCandidateSetId: b.my_vote_candidate_set_id,
    candidateSets: b.candidate_sets.map((cs) => ({
      id: cs.id,
      key: cs.key,
      label: cs.label,
      color: cs.color,
      isDraft: cs.is_draft,
      voteCount: cs.vote_count,
      totalDurationMinutes: cs.total_duration_minutes,
      totalCostCents: cs.total_cost_cents,
      movingMinutes: cs.moving_minutes,
      slackMinutes: cs.slack_minutes,
      stopPinIds: cs.stops.map((s) => s.pin.id),
    })),
  };
}

function phaseProgress(phase) {
  if (phase === "locked") return 1;
  if (phase === "scheduling") return 0.55;
  return 0.15;
}

// Fetches everything one trip's screens need (contributors, pins, blocks)
// and shapes the "also planning" summaries for every other trip, exactly
// as the mount-time load used to inline. Shared by the initial load and by
// OPEN_TRIP (switching which trip is active — see TripsHome's "Also
// planning" rows) so both produce an identical LOADED payload.
async function loadTripView(tripId, trips) {
  const trip = trips.find((t) => t.id === tripId);
  if (!trip) throw new Error("Trip not found.");
  const otherTripRows = trips.filter((t) => t.id !== trip.id);

  const [contributorsRaw, pinsRaw, blocksRaw] = await Promise.all([
    api.listContributors(trip.id),
    api.listPins(trip.id),
    api.listBlocks(trip.id),
  ]);

  const contributors = contributorsRaw.map(normalizeContributor);
  const contributorsById = Object.fromEntries(contributors.map((c) => [c.id, c]));
  const pinsList = pinsRaw.map((p) => normalizePin(p, contributorsById));
  const pins = Object.fromEntries(pinsList.map((p) => [p.id, p]));
  const blocks = blocksRaw.map(normalizeBlock);

  const overrides = {};
  pinsRaw.forEach((p) => {
    (p.availability_overrides || []).forEach((o) => {
      overrides[`${p.id}|${o.day}-${o.band}`] = true;
    });
  });

  const otherTrips = await Promise.all(
    otherTripRows.map(async (t) => {
      const [c, p] = await Promise.all([api.listContributors(t.id), api.listPins(t.id)]);
      return {
        id: t.id,
        name: t.name,
        meta: `${p.length} pin${p.length === 1 ? "" : "s"} · ${c.length} planning`,
        progress: phaseProgress(t.phase),
        phase: t.phase,
      };
    })
  );

  const regionCount = new Set(pinsList.map((p) => p.region)).size;
  const toDecideCount = blocks.filter((b) => b.status === "contested").length;

  const tripView = {
    id: trip.id,
    name: trip.name,
    regionLine: trip.region_line,
    dateLine: formatDateRange(trip.start_date, trip.end_date),
    startDate: trip.start_date,
    endDate: trip.end_date,
    phase: trip.phase,
    contributorCount: contributors.length,
    metrics: { pins: pinsList.length, regions: regionCount, toDecide: toDecideCount },
  };

  const currentUserId = contributors.find((c) => c.isOwner)?.id ?? contributors[0]?.id ?? null;

  return {
    trip: tripView,
    otherTrips,
    contributors,
    contributorOverflowCount: Math.max(0, contributors.length - 4),
    pins,
    overrides,
    blocks,
    currentUserId,
  };
}

const initialState = {
  status: "loading", // "loading" | "ready" | "error"
  error: null,
  trip: null,
  otherTrips: [],
  contributors: [],
  contributorOverflowCount: 0,
  pins: {},
  overrides: {}, // "<pinId>|<day>-<band>": boolean
  blocks: [],
  selectedSet: "A", // "A" | "B" | "C" — for the (single, for now) contested block
  myVoteC: false, // local-only: voted for your own not-yet-real Set C draft
  lockedC: false, // local-only: "locked" Set C — never persists, nothing to send it to
  draft: [], // pinId[] — the current user's Set C
  currentUserId: null,
  switchingTripId: null, // id of an "also planning" trip currently being opened, or null
};

function reducer(state, action) {
  switch (action.type) {
    case "LOADED":
      return { ...state, status: "ready", error: null, switchingTripId: null, ...action.payload };
    case "LOAD_ERROR":
      return { ...state, status: "error", error: action.error, switchingTripId: null };

    case "SWITCH_TRIP_START":
      return { ...state, switchingTripId: action.tripId };
    case "SWITCH_TRIP_FAILED":
      return { ...state, switchingTripId: null };

    case "SELECT_SET":
      return { ...state, selectedSet: action.key };

    case "TOGGLE_POOL_PIN": {
      const has = state.draft.includes(action.id);
      const draft = has ? state.draft.filter((id) => id !== action.id) : [...state.draft, action.id];
      return { ...state, draft, selectedSet: draft.length ? "C" : state.selectedSet };
    }

    case "TOGGLE_VOTE_C":
      return { ...state, myVoteC: !state.myVoteC };
    case "LOCK_C":
      return { ...state, lockedC: true };
    case "REOPEN_C":
      return { ...state, lockedC: false };

    case "ADD_TRIP":
      return { ...state, otherTrips: [...state.otherTrips, action.trip] };

    case "APPLY_TRIP":
      return { ...state, trip: { ...state.trip, ...action.trip } };

    case "APPLY_BLOCK":
      return { ...state, blocks: state.blocks.map((b) => (b.id === action.block.id ? action.block : b)) };

    case "APPLY_PIN":
      return { ...state, pins: { ...state.pins, [action.pin.id]: action.pin } };

    case "SET_OVERRIDE": {
      const key = `${action.pinId}|${action.day}-${action.band}`;
      return { ...state, overrides: { ...state.overrides, [key]: action.overridden } };
    }

    case "SET_CURRENT_USER":
      return { ...state, currentUserId: action.id };

    default:
      return state;
  }
}

const PlannerStateContext = createContext(null);
const PlannerDispatchContext = createContext(null);

export function PlannerProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    // No "already started" guard here on purpose: React 18 StrictMode
    // double-invokes effects in development specifically to catch bugs
    // like a stray guard swallowing the second, real run — this effect
    // relies only on the standard cancelled-closure pattern below, so the
    // discarded first run's in-flight fetches are harmless and the second
    // run dispatches normally.
    let cancelled = false;

    async function load() {
      try {
        const trips = await api.listTrips();
        if (!trips.length) {
          throw new Error('No trips in the database yet. From backend/, run: uv run python -m app.seed');
        }
        const initialTrip = trips.find((t) => t.name === "Taiwan") ?? trips[0];
        const payload = await loadTripView(initialTrip.id, trips);
        if (cancelled) return;
        dispatch({ type: "LOADED", payload });
      } catch (err) {
        if (!cancelled) dispatch({ type: "LOAD_ERROR", error: err.message || String(err) });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const day5Block = useMemo(() => state.blocks.find((b) => b.dayIndex === 5) ?? null, [state.blocks]);

  const lockedSetKey = useMemo(() => {
    if (day5Block?.status === "locked") {
      return day5Block.candidateSets.find((cs) => cs.id === day5Block.lockedSetId)?.key ?? null;
    }
    return state.lockedC ? "C" : null;
  }, [day5Block, state.lockedC]);

  const dispatchRef = useRef();
  dispatchRef.current = useMemo(
    () => async (action) => {
      switch (action.type) {
        case "SELECT_SET":
        case "TOGGLE_POOL_PIN":
        case "SET_CURRENT_USER":
          dispatch(action);
          return;

        case "CREATE_TRIP": {
          // Trip creation always goes through the API (there's no local
          // fallback the way Set C has one) — the new trip needs a real id
          // before anything else can reference it. On success, fold it
          // into "otherTrips" the same shape load() builds them in; a full
          // trip-switching flow (making the new trip the active TRIP) is
          // out of scope here, same as the rest of "Also planning".
          const trip = await api.createTrip(action.payload);
          dispatch({
            type: "ADD_TRIP",
            trip: {
              id: trip.id,
              name: trip.name,
              meta: "0 pins · 1 planning",
              progress: phaseProgress(trip.phase),
              phase: trip.phase,
            },
          });
          return trip;
        }

        case "UPDATE_TRIP": {
          // Trip settings (see pages/TripSettings.jsx) — name, regions,
          // and start/end dates on the currently-active trip only (there's
          // no flow yet for editing a trip you haven't opened — see
          // OPEN_TRIP just below for how "active" gets set). Reuses
          // APPLY_TRIP, which shallow-merges into state.trip.
          const updated = await api.updateTrip(state.trip.id, action.fields);
          dispatch({
            type: "APPLY_TRIP",
            trip: {
              name: updated.name,
              regionLine: updated.region_line,
              dateLine: formatDateRange(updated.start_date, updated.end_date),
              startDate: updated.start_date,
              endDate: updated.end_date,
              phase: updated.phase,
            },
          });
          return updated;
        }

        case "OPEN_TRIP": {
          // Makes another "also planning" trip the active TRIP (see
          // TripsHome), so its own pins/contributors/blocks back
          // /board, /map, /schedule, etc. Keeps the router mounted the
          // whole time (no "loading" full-screen swap) — the caller
          // awaits this and navigates itself once it resolves, so a
          // failure just leaves the user on Trips Home with nothing
          // changed.
          dispatch({ type: "SWITCH_TRIP_START", tripId: action.tripId });
          try {
            const trips = await api.listTrips();
            const payload = await loadTripView(action.tripId, trips);
            dispatch({ type: "LOADED", payload });
          } catch (err) {
            dispatch({ type: "SWITCH_TRIP_FAILED" });
            throw err;
          }
          return;
        }

        case "CREATE_PIN": {
          // Board screen "add a pin from a link" (see pages/NewPin.jsx).
          // Reuses APPLY_PIN — same reducer case PATCH_PIN already lands
          // on — since inserting a brand-new id into the pins map and
          // overwriting an existing one are the same operation.
          const created = await api.createPin(state.trip.id, action.payload);
          const contributorsById = Object.fromEntries(state.contributors.map((c) => [c.id, c]));
          const pin = normalizePin(created, contributorsById);
          dispatch({ type: "APPLY_PIN", pin });
          return pin;
        }

        case "TOGGLE_VOTE": {
          if (action.key === "C") {
            dispatch({ type: "TOGGLE_VOTE_C" });
            return;
          }
          if (!day5Block) return;
          const set = day5Block.candidateSets.find((s) => s.key === action.key);
          if (!set) return;
          try {
            const updated = await api.toggleVote(day5Block.id, set.id);
            dispatch({ type: "APPLY_BLOCK", block: normalizeBlock(updated) });
          } catch (err) {
            console.error("toggle vote failed", err);
          }
          return;
        }

        case "LOCK_SET": {
          if (action.key === "C") {
            dispatch({ type: "LOCK_C" });
            return;
          }
          if (!day5Block) return;
          const set = day5Block.candidateSets.find((s) => s.key === action.key);
          if (!set) return;
          try {
            const updated = await api.lockBlock(day5Block.id, set.id);
            dispatch({ type: "APPLY_BLOCK", block: normalizeBlock(updated) });
          } catch (err) {
            console.error("lock failed", err);
          }
          return;
        }

        case "REOPEN_LOCK": {
          if (lockedSetKey === "C") {
            dispatch({ type: "REOPEN_C" });
            return;
          }
          if (!day5Block) return;
          try {
            const updated = await api.reopenBlock(day5Block.id);
            dispatch({ type: "APPLY_BLOCK", block: normalizeBlock(updated) });
          } catch (err) {
            console.error("reopen failed", err);
          }
          return;
        }

        case "PATCH_PIN": {
          const backendFields = {};
          const f = action.fields;
          if ("title" in f) backendFields.title = f.title;
          if ("dur" in f) backendFields.duration_minutes = f.dur;
          if ("cost" in f) backendFields.cost_cents = Math.round(f.cost * 100);
          if ("notes" in f) backendFields.notes = f.notes;
          if ("link" in f) backendFields.link = f.link;
          if ("tags" in f) backendFields.tags = f.tags;
          try {
            const updated = await api.patchPin(action.id, backendFields);
            const contributorsById = Object.fromEntries(state.contributors.map((c) => [c.id, c]));
            dispatch({ type: "APPLY_PIN", pin: normalizePin(updated, contributorsById) });
          } catch (err) {
            console.error("pin update failed", err);
          }
          return;
        }

        case "TOGGLE_OVERRIDE": {
          try {
            const result = await api.toggleAvailabilityOverride(action.pinId, action.day, action.band);
            dispatch({
              type: "SET_OVERRIDE",
              pinId: action.pinId,
              day: action.day,
              band: action.band,
              overridden: result.overridden,
            });
          } catch (err) {
            console.error("availability override failed", err);
          }
          return;
        }

        default:
          return;
      }
    },
    [day5Block, lockedSetKey, state.contributors, state.trip?.id]
  );
  // Stable function identity across renders (children never need to
  // re-subscribe just because a background fetch resolved).
  const stableDispatch = useMemo(() => (action) => dispatchRef.current(action), []);

  const value = useMemo(() => ({ ...state, day5Block, lockedSetKey }), [state, day5Block, lockedSetKey]);

  if (state.status === "loading") {
    return (
      <div className="screen" style={{ alignItems: "center", justifyContent: "center", display: "flex" }}>
        <div className="mono-caption">Loading trip…</div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="screen" style={{ alignItems: "center", justifyContent: "center", display: "flex", padding: 24 }}>
        <div style={{ maxWidth: 320, textAlign: "center" }}>
          <div style={{ font: "600 15px var(--font-sans)", color: "var(--text-primary)", marginBottom: 8 }}>
            Couldn&rsquo;t load the trip
          </div>
          <div style={{ font: "400 13px var(--font-sans)", color: "var(--text-secondary)", marginBottom: 20 }}>{state.error}</div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ padding: "10px 16px", borderRadius: "var(--radius-lg)", border: "none", background: "var(--surface-inverse)", color: "#fff", font: "600 13px var(--font-sans)", cursor: "pointer" }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{ padding: "10px 16px", borderRadius: "var(--radius-lg)", border: "1px solid var(--border-strong)", color: "var(--text-primary)", font: "600 13px var(--font-sans)", textDecoration: "none", display: "inline-flex", alignItems: "center" }}
            >
              ⌂ Trips home
            </a>
          </div>
          <div style={{ marginTop: 16, font: "400 11px var(--font-sans)", color: "var(--text-muted)" }}>
            Running this locally? Make sure the backend is up (see README &ldquo;Local development&rdquo;).
          </div>
        </div>
      </div>
    );
  }

  return (
    <PlannerStateContext.Provider value={value}>
      <PlannerDispatchContext.Provider value={stableDispatch}>{children}</PlannerDispatchContext.Provider>
    </PlannerStateContext.Provider>
  );
}

export function usePlannerState() {
  const ctx = useContext(PlannerStateContext);
  if (!ctx) throw new Error("usePlannerState must be used within PlannerProvider");
  return ctx;
}

export function usePlannerDispatch() {
  const ctx = useContext(PlannerDispatchContext);
  if (!ctx) throw new Error("usePlannerDispatch must be used within PlannerProvider");
  return ctx;
}

export function useCurrentUser() {
  const { contributors, currentUserId } = usePlannerState();
  return (
    contributors.find((c) => c.id === currentUserId) ??
    contributors[0] ?? { id: null, name: "You", initial: "?", tint: "var(--who-1)", isOwner: false }
  );
}
