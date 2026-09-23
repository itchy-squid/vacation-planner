import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { api } from "../lib/api";
import { coordsForPin } from "../lib/mapLayout";
import { formatDateRange, relativeTime } from "../lib/format";
import { parseApiDateTime } from "../lib/planTime";
import { roleLabel } from "../lib/roles";

// Remembers which trip was last active so a page refresh reopens it
// instead of always falling back to the hardcoded "Taiwan" default (see
// loadTripView's callers below). Deliberately a plain localStorage read/
// write rather than a Trip field — this is a per-browser UI preference,
// not trip data anyone else on the trip should see. Wrapped in try/catch
// since localStorage can throw (private browsing, disabled storage) —
// losing the "remember" behavior in that case is fine, breaking the app
// isn't.
const LAST_TRIP_ID_STORAGE_KEY = "vacationPlanner:lastTripId";

function rememberLastTripId(tripId) {
  try {
    window.localStorage.setItem(LAST_TRIP_ID_STORAGE_KEY, String(tripId));
  } catch {
    // ignore — storage unavailable
  }
}

function readLastTripId() {
  try {
    return window.localStorage.getItem(LAST_TRIP_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

// Client-side state, sourced from the real FastAPI + Postgres backend.
// Trip, contributors, pins, and the trip's scheduling data (Plans,
// TravelItems — see docs/features/scheduling-feature-spec.md) all come
// from the API on mount. Scheduling used to be an earlier Block/
// CandidateSet design with a single hardcoded "Day 5" contested block;
// this replaces it with the spec's Plan/PlanItem/Contest/Vote model, where
// any number of days can have any number of open contests at once, and
// "propose an alternative" is a real user action rather than pre-seeded
// content.
//
// This store deliberately keeps only what every screen needs to
// position/list things (plans, travelItems). Full contest detail — the
// vote tally and per-plan "did I vote for this" flag — is fetched fresh by
// pages/CompareSets.jsx itself via api.getContest() rather than normalized
// in here, since that data only matters while that one screen is open and
// changes with every vote; see REFRESH_PLANS_AND_ITEMS below for how the
// calendar picks up a lock/reopen's effect once the user navigates back.

function normalizeContributor(c) {
  return {
    id: c.id,
    name: c.display_name,
    initial: c.initial,
    tint: c.tint,
    // owner | planner | companion | reader — see lib/roles.js.
    role: c.role ?? (c.is_owner ? "owner" : "planner"),
    isOwner: c.is_owner,
    email: c.email,
  };
}

// A cost the caller isn't allowed to see (no costs:read) arrives as null,
// which is different from a free item's 0. Keep it null all the way to the
// screen so nothing renders "$0" for a price the viewer simply can't see.
function dollarsOrNull(cents) {
  return cents == null ? null : Math.round(cents / 100);
}

// Everything the trip screens need to know about the viewer's standing on
// the active trip, from the trip payload itself (backend TripOut).
function accessFromTrip(t) {
  return {
    role: t.my_role,
    scopes: t.my_scopes ?? [],
    owner: t.owner
      ? { id: t.owner.id, name: t.owner.display_name, email: t.owner.email, initial: t.owner.initial, tint: t.owner.tint }
      : null,
    memberCount: t.member_count ?? 0,
  };
}


// "Your trip" / "Kenji's trip · Reader" — the ownership line on Trips Home.
export function ownershipLine(trip) {
  if (!trip) return "";
  if (trip.role === "owner") return "Your trip";
  const owner = trip.owner?.name ? `${trip.owner.name}'s trip` : "Shared with you";
  return `${owner} · ${roleLabel(trip.role)}`;
}

export { roleLabel };

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
    cost: dollarsOrNull(p.cost_cents),
    costCents: p.cost_cents ?? null,
    // Contributor ids sharing this cost; [] means everyone on the trip.
    // Kept as raw ids rather than resolved contributors so a head who has
    // since left the trip doesn't silently vanish from the split.
    heads: p.heads ?? [],
    who: addedBy?.id ?? null,
    whoName: addedBy?.name ?? "Someone",
    addedAgo: relativeTime(p.added_at),
    notes: p.notes,
    link: p.link,
    tags: p.tags,
    // Chosen from the linked page when the pin was added (see
    // pages/NewPin.jsx). Null for every pin added before that flow
    // existed, and for anyone who picked "No image" — surfaces fall back
    // to the striped placeholder.
    photoUrl: p.photo_url,
    photoSourceUrl: p.photo_source_url,
    availabilityRule: p.availability_rule
      ? { days: p.availability_rule.days, bands: p.availability_rule.bands, why: p.availability_rule.reasons }
      : { days: null, bands: null, why: [] },
  };
}

function normalizeTravelItem(t, contributorsById) {
  const addedBy = t.added_by_id ? contributorsById[t.added_by_id] : null;
  return {
    id: t.id,
    tripId: t.trip_id,
    title: t.title,
    kind: t.kind,
    dur: t.duration_minutes,
    cost: dollarsOrNull(t.cost_cents),
    costCents: t.cost_cents ?? null,
    heads: t.heads ?? [],
    notes: t.notes,
    link: t.link,
    who: addedBy?.id ?? null,
    whoName: addedBy?.name ?? "Someone",
    addedAgo: relativeTime(t.added_at),
  };
}

function normalizePlanItem(it) {
  const source = it.pin ?? it.travel_item;
  return {
    pinId: it.pin?.id ?? null,
    travelItemId: it.travel_item?.id ?? null,
    title: source?.title ?? "Untitled",
    // What this placement is actually as long as — the trim if there is
    // one, the item's own duration otherwise. Same resolution order as
    // backend/app/derive.py's item_duration.
    durationMinutes: it.duration_minutes ?? source?.duration_minutes ?? 0,
    // Kept separately so a screen can tell "trimmed to 90m" from "the pin
    // is 90m" — that's the difference between the stops list reading
    // "1H 30M · SHORTENED FROM 3H" and just "1H 30M".
    durationOverrideMinutes: it.duration_minutes ?? null,
    baseDurationMinutes: source?.duration_minutes ?? 0,
    offsetMinutes: it.offset_minutes ?? null,
    // Served pre-computed by the API so no screen re-derives packing.
    startMinuteOfDay: it.start_minute_of_day ?? null,
    costCents: source ? source.cost_cents ?? null : 0,
    heads: source?.heads ?? [],
    position: it.position,
  };
}

function normalizePlan(p) {
  return {
    id: p.id,
    tripId: p.trip_id,
    startsAt: p.starts_at,
    endsAt: p.ends_at,
    startDt: parseApiDateTime(p.starts_at),
    endDt: parseApiDateTime(p.ends_at),
    label: p.label,
    color: p.color,
    status: p.status, // "draft" | "placed" | "pencilled" | "contested" | "locked"
    contestId: p.contest_id,
    createdById: p.created_by_id ?? null,
    // The proposer's case for this plan, shown to voters on the compare
    // screen. Empty for anything not proposed through the block flow.
    rationale: p.rationale ?? "",
    // Contributor ids this plan is for; [] is everyone (lib/party.js).
    party: p.party ?? [],
    items: (p.items ?? []).map(normalizePlanItem),
    totalDurationMinutes: p.total_duration_minutes,
    totalCostCents: p.total_cost_cents ?? null,
    // No movingMinutes: there is one definition of slack now, and it
    // doesn't subtract a guess at travel time. See backend/app/derive.py.
    slackMinutes: p.slack_minutes,
  };
}

// The two ways a proposal can be refused, unpacked into something a
// screen can say out loud. `contest` carries the hours already out for a
// vote so step 2 can name them; `locked` carries the pinned item the
// selection should have clipped at. Anything else is a real failure.
function proposalConflict(err) {
  if (err.status !== 409) return null;
  const detail = err.body?.detail;
  if (!detail || typeof detail === "string") return null;
  if (detail.contest_id) {
    return {
      conflict: "contest",
      contestId: detail.contest_id,
      contestStartsAt: detail.starts_at,
      contestEndsAt: detail.ends_at,
      message: detail.message,
    };
  }
  if (detail.locked_plan_id) {
    return { conflict: "locked", lockedPlanId: detail.locked_plan_id, message: detail.message };
  }
  return null;
}

// What the server said, when it said something worth repeating. Refusals
// from the planning endpoints carry a written sentence — "Vase Rock runs
// past the end of the block" — and dropping it in favour of the generic
// "PUT /api/… → 400" would throw away the only part a reader can act on.
function apiMessage(err) {
  const detail = err.body?.detail;
  if (typeof detail === "string") return detail;
  if (detail?.message) return detail.message;
  return err.message;
}

function phaseProgress(phase) {
  if (phase === "locked") return 1;
  if (phase === "scheduling") return 0.55;
  return 0.15;
}

// Fetches everything one trip's screens need (contributors, pins, plans,
// travel items) and shapes the "also planning" summaries for every other
// trip, exactly as the mount-time load used to inline. Shared by the
// initial load and by OPEN_TRIP (switching which trip is active — see
// TripsHome's "Also planning" rows) so both produce an identical LOADED
// payload.
// The payload for "the database has no trips at all" — the same shape
// loadTripView returns below, with nothing in it. Deliberately a LOADED
// payload rather than a fourth status: an empty database is a perfectly
// successful load that happens to contain no trip, not a failure, and
// routing it through the normal ready path is what lets TripsHome render
// its own empty state (pages/TripsHome.jsx) with the "+" still in reach,
// instead of the provider swapping the entire router out for a
// full-screen message the user can't act on.
function emptyTripView() {
  return {
    trip: null,
    otherTrips: [],
    contributors: [],
    contributorOverflowCount: 0,
    pins: {},
    overrides: {},
    plans: [],
    travelItems: {},
    currentUserId: null,
  };
}

async function loadTripView(tripId, trips) {
  const trip = trips.find((t) => t.id === tripId);
  if (!trip) throw new Error("Trip not found.");
  // Every path that lands on a trip (initial load, a URL-linked trip, or
  // OPEN_TRIP's "Also planning" switch) runs through here, so this is the
  // one place that needs to record it for next time.
  rememberLastTripId(trip.id);
  const otherTripRows = trips.filter((t) => t.id !== trip.id);

  const [contributorsRaw, pinsRaw, plansRaw, travelItemsRaw] = await Promise.all([
    api.listContributors(trip.id),
    api.listPins(trip.id),
    api.listPlans(trip.id),
    api.listTravelItems(trip.id),
  ]);

  const contributors = contributorsRaw.map(normalizeContributor);
  const contributorsById = Object.fromEntries(contributors.map((c) => [c.id, c]));
  const pinsList = pinsRaw.map((p) => normalizePin(p, contributorsById));
  const pins = Object.fromEntries(pinsList.map((p) => [p.id, p]));
  const plans = plansRaw.map(normalizePlan);
  const travelItemsList = travelItemsRaw.map((t) => normalizeTravelItem(t, contributorsById));
  const travelItems = Object.fromEntries(travelItemsList.map((t) => [t.id, t]));

  const overrides = {};
  pinsRaw.forEach((p) => {
    (p.availability_overrides || []).forEach((o) => {
      overrides[`${p.id}|${o.day}-${o.band}`] = true;
    });
  });

  const otherTrips = await Promise.all(
    otherTripRows.map(async (t) => {
      const p = await api.listPins(t.id);
      const access = accessFromTrip(t);
      return {
        id: t.id,
        name: t.name,
        meta: `${p.length} pin${p.length === 1 ? "" : "s"} · ${access.memberCount} planning`,
        ownership: ownershipLine(access),
        progress: phaseProgress(t.phase),
        phase: t.phase,
      };
    })
  );

  // Locations on Trips Home (the primary card's subtitle line and its
  // "regions" tile) reflect what the group is actually doing, not just
  // what's pinned or what someone once typed into Trip Settings: prefer
  // the regions of pins that have made it onto the calendar (referenced
  // by any Plan, regardless of status — see the Plan data model, "one
  // scheduled placement"), and only fall back to every pinned region when
  // nothing has been scheduled yet (e.g. a brand-new trip still in
  // ideation). Order follows each pin's position in pinsList so the line
  // reads in a stable, sensible order rather than Set-insertion order.
  const distinctRegionsInOrder = (pinsSubset) => {
    const seen = new Set();
    const ordered = [];
    pinsSubset.forEach((p) => {
      if (p.region && !seen.has(p.region)) {
        seen.add(p.region);
        ordered.push(p.region);
      }
    });
    return ordered;
  };
  const scheduledPinIds = new Set(
    plans
      // A draft claims nothing — not a slot on the calendar, and not a
      // region on the home card either.
      .filter((plan) => plan.status !== "draft")
      .flatMap((plan) => plan.items.map((item) => item.pinId))
      .filter(Boolean)
  );
  const scheduledRegionNames = distinctRegionsInOrder(pinsList.filter((p) => scheduledPinIds.has(p.id)));
  const pinnedRegionNames = distinctRegionsInOrder(pinsList);
  const locationNames = scheduledRegionNames.length > 0 ? scheduledRegionNames : pinnedRegionNames;
  const regionCount = locationNames.length;
  // "To decide" counts open contests, not contested plans — a contest
  // with two competing plans is one decision the group owes, not two.
  const toDecideCount = new Set(plans.filter((p) => p.status === "contested").map((p) => p.contestId)).size;

  // Trips Home's primary-card subtitle shows this instead of the raw
  // region_line field below: the derived list above when there's any pin
  // data to derive it from, and the trip's own hand-typed region_line
  // (set in Trip Settings / at creation — see NewTrip.jsx) only as a last
  // resort for a brand-new trip that has no pins yet at all.
  const locationsLine = locationNames.length > 0 ? locationNames.join(" · ") : trip.region_line;

  const tripView = {
    id: trip.id,
    name: trip.name,
    regionLine: trip.region_line,
    locationsLine,
    dateLine: formatDateRange(trip.start_date, trip.end_date),
    startDate: trip.start_date,
    endDate: trip.end_date,
    phase: trip.phase,
    contributorCount: contributors.length,
    // How many people the trip is *costed* for, which is not how many are
    // planning it. null means "as many as there are contributors" — see
    // headcountFor below, the one place that fallback is spelled out.
    travellerCount: trip.traveller_count ?? null,
    metrics: { pins: pinsList.length, regions: regionCount, toDecide: toDecideCount },
    // The viewer's role and scopes on this trip, plus who owns it. Used to
    // hide controls the server would refuse anyway — see useCan below.
    ...accessFromTrip(trip),
  };

  // The signed-in person's own row on this trip, straight from the server
  // (TripOut.my_contributor_id) rather than guessed from the roster.
  const currentUserId = trip.my_contributor_id ?? null;

  return {
    trip: tripView,
    otherTrips,
    contributors,
    contributorOverflowCount: Math.max(0, contributors.length - 4),
    pins,
    overrides,
    plans,
    travelItems,
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
  plans: [], // Plan[], each carrying contestId (null unless contested/locked-from-a-contest)
  travelItems: {}, // travelItemId -> TravelItem
  currentUserId: null,
  switchingTripId: null, // id of an "also planning" trip currently being opened, or null

  // Placement UI (see pages/DaySchedule.jsx). "placing" is the armed
  // tray item being tap-placed; "proposeSheet" is the propose-an-
  // alternative confirmation opened when a tap lands on an occupied,
  // non-locked slot. Moving an already-placed plan is a drag gesture
  // (see MOVE_PLAN below) and doesn't go through "placing" at all. Both
  // of these are transient/local — nothing here persists until PLACE_AT /
  // CONFIRM_PROPOSE actually call the API.
  placing: null, // { kind: "pin" | "travel", refId, durationMinutes, label }
  proposeSheet: null, // { targetPlanId, targetLabel, dayIndex, startMinute, kind, refId, durationMinutes, label }
};

function reducer(state, action) {
  switch (action.type) {
    case "LOADED":
      return { ...state, status: "ready", error: null, switchingTripId: null, placing: null, proposeSheet: null, ...action.payload };
    case "LOAD_ERROR":
      return { ...state, status: "error", error: action.error, switchingTripId: null };

    case "SWITCH_TRIP_START":
      return { ...state, switchingTripId: action.tripId };
    case "SWITCH_TRIP_FAILED":
      return { ...state, switchingTripId: null };

    case "SET_PLANS_AND_ITEMS":
      return { ...state, plans: action.plans, travelItems: action.travelItems };

    case "ARM_PLACEMENT":
      return { ...state, placing: action.placing, proposeSheet: null };
    case "CANCEL_PLACING":
      return { ...state, placing: null };

    case "OPEN_PROPOSE":
      return { ...state, placing: null, proposeSheet: action.proposeSheet };
    case "CLOSE_PROPOSE":
      return { ...state, proposeSheet: null };

    case "ADD_TRIP":
      return { ...state, otherTrips: [...state.otherTrips, action.trip] };

    case "APPLY_TRIP":
      return { ...state, trip: { ...state.trip, ...action.trip } };

    case "APPLY_PIN":
      return { ...state, pins: { ...state.pins, [action.pin.id]: action.pin } };

    case "APPLY_TRAVEL_ITEM":
      return { ...state, travelItems: { ...state.travelItems, [action.item.id]: action.item } };
    case "REMOVE_TRAVEL_ITEM": {
      const next = { ...state.travelItems };
      delete next[action.id];
      return { ...state, travelItems: next };
    }

    case "REMOVE_PIN": {
      const next = { ...state.pins };
      delete next[action.id];
      return { ...state, pins: next };
    }

    case "SET_OVERRIDE": {
      const key = `${action.pinId}|${action.day}-${action.band}`;
      return { ...state, overrides: { ...state.overrides, [key]: action.overridden } };
    }

    case "SET_CURRENT_USER":
      return { ...state, currentUserId: action.id };

    case "SET_MEMBERS":
      return {
        ...state,
        contributors: action.contributors,
        contributorOverflowCount: Math.max(0, action.contributors.length - 4),
        trip: state.trip ? { ...state.trip, ...action.trip } : state.trip,
      };

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
          // Nothing to open yet — a fresh database, or a new user who
          // hasn't made a trip. Render the app normally with no active
          // trip; TripsHome shows its empty state and App.jsx keeps the
          // trip-scoped routes unreachable until there's a trip to scope
          // them to, so nothing downstream has to cope with a null trip.
          // Returning here also skips the URL/last-trip resolution below,
          // which has nothing to resolve against.
          if (cancelled) return;
          dispatch({ type: "LOADED", payload: emptyTripView() });
          return;
        }
        // Every trip-scoped route is /trips/:tripId/... (see App.jsx) — a
        // shared link carries the trip right in the URL, so a fresh load
        // opens straight into that trip instead of whatever trip happened
        // to load last. Read via window.location rather than useLocation()
        // on purpose: this effect is mount-only (deliberately does not
        // react to in-app navigation — TripsHome's OPEN_TRIP already
        // handles switching trips while the app is running).
        const urlMatch = window.location.pathname.match(/^\/trips\/([^/]+)/);
        const tripIdFromUrl = urlMatch ? urlMatch[1] : null;
        // Trip ids are plain integers (not UUID strings — see
        // backend/app/models.py), but a URL segment is always a string, so
        // compare as strings rather than `t.id === tripIdFromUrl`.
        const linkedTrip = tripIdFromUrl ? trips.find((t) => String(t.id) === tripIdFromUrl) : null;
        if (tripIdFromUrl && !linkedTrip) {
          throw new Error(
            "That trip isn't in your list. If someone shared it with you, open the invite link they sent to add it."
          );
        }
        // No trip in the URL: fall back to whichever trip was last active
        // (see rememberLastTripId/readLastTripId above) so a plain
        // refresh — or reopening the tab later — comes back to the same
        // trip instead of always resetting to "Taiwan". If that id no
        // longer matches a real trip (deleted, or nothing cached yet),
        // fall through to the original defaults.
        const lastTripId = !linkedTrip ? readLastTripId() : null;
        const lastTrip = lastTripId ? trips.find((t) => String(t.id) === lastTripId) : null;
        const initialTrip = linkedTrip ?? lastTrip ?? trips.find((t) => t.name === "Taiwan") ?? trips[0];
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

  const dispatchRef = useRef();
  dispatchRef.current = useMemo(
    () => async (action) => {
      switch (action.type) {
        case "ARM_PLACEMENT":
        case "CANCEL_PLACING":
        case "OPEN_PROPOSE":
        case "CLOSE_PROPOSE":
        case "SET_CURRENT_USER":
          dispatch(action);
          return;

        case "ARM_PLACE_PIN": {
          const pin = state.pins[action.pinId];
          if (!pin) return;
          dispatch({
            type: "ARM_PLACEMENT",
            placing: { kind: "pin", refId: pin.id, durationMinutes: pin.dur, label: pin.short || pin.title },
          });
          return;
        }

        case "ARM_PLACE_TRAVEL": {
          const item = state.travelItems[action.travelItemId];
          if (!item) return;
          dispatch({
            type: "ARM_PLACEMENT",
            placing: { kind: "travel", refId: item.id, durationMinutes: item.dur, label: item.title },
          });
          return;
        }

        // Who's on the trip and the viewer's own role changed (someone
        // joined, left, or had their role changed). Re-reads the roster and
        // the trip's access fields, then the rest of the trip, since a role
        // change can change which costs come back.
        case "REFRESH_MEMBERS": {
          if (!state.trip) return;
          const trips = await api.listTrips();
          if (!trips.some((t) => t.id === state.trip.id)) {
            // No longer on this trip (removed by the owner).
            const payload = trips.length ? await loadTripView(trips[0].id, trips) : emptyTripView();
            dispatch({ type: "LOADED", payload });
            return { ok: true, removed: true };
          }
          const payload = await loadTripView(state.trip.id, trips);
          dispatch({ type: "LOADED", payload });
          return { ok: true };
        }

        // Accept an invite link and make that trip the active one.
        case "JOIN_TRIP": {
          try {
            const joined = await api.acceptInvite(action.token);
            const trips = await api.listTrips();
            const payload = await loadTripView(joined.id, trips);
            dispatch({ type: "LOADED", payload });
            return { ok: true, tripId: joined.id, tripName: joined.name };
          } catch (err) {
            console.error("join failed", err);
            return { ok: false, error: apiMessage(err), gone: err.status === 404 };
          }
        }

        case "LEAVE_TRIP": {
          if (!state.trip) return { ok: false };
          try {
            await api.leaveTrip(state.trip.id);
            const trips = await api.listTrips();
            const payload = trips.length ? await loadTripView(trips[0].id, trips) : emptyTripView();
            dispatch({ type: "LOADED", payload });
            return { ok: true };
          } catch (err) {
            console.error("leave failed", err);
            return { ok: false, error: apiMessage(err) };
          }
        }

        case "CHANGE_ROLE":
        case "REMOVE_MEMBER": {
          if (!state.trip) return { ok: false };
          try {
            if (action.type === "CHANGE_ROLE") {
              await api.changeRole(state.trip.id, action.contributorId, action.role);
            } else {
              await api.removeContributor(state.trip.id, action.contributorId);
            }
            const [contributorsRaw, tripRaw] = await Promise.all([
              api.listContributors(state.trip.id),
              api.getTrip(state.trip.id),
            ]);
            const contributors = contributorsRaw.map(normalizeContributor);
            dispatch({
              type: "SET_MEMBERS",
              contributors,
              trip: { ...accessFromTrip(tripRaw), contributorCount: contributors.length },
            });
            return { ok: true };
          } catch (err) {
            console.error("member update failed", err);
            return { ok: false, error: apiMessage(err) };
          }
        }

        case "REFRESH_PLANS_AND_ITEMS": {
          if (!state.trip) return;
          const contributorsById = Object.fromEntries(state.contributors.map((c) => [c.id, c]));
          const [plansRaw, travelItemsRaw] = await Promise.all([
            api.listPlans(state.trip.id),
            api.listTravelItems(state.trip.id),
          ]);
          dispatch({
            type: "SET_PLANS_AND_ITEMS",
            plans: plansRaw.map(normalizePlan),
            travelItems: Object.fromEntries(travelItemsRaw.map((t) => [t.id, normalizeTravelItem(t, contributorsById)])),
          });
          return;
        }

        // Direct placement of the currently-armed tray item — see spec
        // "Direct placement". A 409 (slot already occupied) is not
        // treated as a failure: it's converted into OPEN_PROPOSE so the
        // caller can fall into the propose-alternative flow instead, per
        // spec "A caller who receives this should use the propose-
        // alternative flow instead of retrying direct placement."
        case "PLACE_AT": {
          const placing = state.placing;
          if (!placing || !state.trip) return { ok: false };
          try {
            await api.createPlan(state.trip.id, {
              starts_at: action.startsAt,
              ends_at: action.endsAt,
              status: "placed",
              items: [placing.kind === "pin" ? { pin_id: placing.refId } : { travel_item_id: placing.refId }],
            });
            await dispatchRef.current({ type: "REFRESH_PLANS_AND_ITEMS" });
            dispatch({ type: "CANCEL_PLACING" });
            return { ok: true };
          } catch (err) {
            if (err.status === 409 && err.body?.detail?.occupying_plan_id) {
              const target = state.plans.find((p) => p.id === err.body.detail.occupying_plan_id);
              dispatch({
                type: "OPEN_PROPOSE",
                proposeSheet: {
                  targetPlanId: err.body.detail.occupying_plan_id,
                  party: target?.party ?? [],
                  dayIndex: action.dayIndex,
                  startMinute: action.startMinute,
                  kind: placing.kind,
                  refId: placing.refId,
                  durationMinutes: placing.durationMinutes,
                  label: placing.label,
                },
              });
              return { ok: false, opened: "propose" };
            }
            console.error("place failed", err);
            return { ok: false, error: err.message };
          }
        }

        // Drag-to-reschedule (pages/DaySchedule.jsx's pointer-drag handling
        // on a placed/pencilled block) — keeps the plan's duration fixed
        // and only changes starts_at/ends_at, per spec "Moving / unplacing".
        // Unlike PLACE_AT, this has no tray item or "placing" state behind
        // it, so a 409 (someone else placed something there first) is just
        // reported back as an occupied error for the caller to show and
        // revert, rather than opening the propose-alternative sheet.
        case "MOVE_PLAN": {
          try {
            await api.movePlan(action.planId, { starts_at: action.startsAt, ends_at: action.endsAt });
            await dispatchRef.current({ type: "REFRESH_PLANS_AND_ITEMS" });
            return { ok: true };
          } catch (err) {
            if (err.status === 409) {
              // The message names who is double-booked when the plan is
              // for part of the group (backend occupied_detail).
              return { ok: false, occupied: true, message: apiMessage(err) };
            }
            console.error("move failed", err);
            return { ok: false, error: err.message };
          }
        }

        case "OPEN_PROPOSE_FOR": {
          // Direct route to the sheet when the caller already knows the
          // tap landed on an occupied slot (see pages/DaySchedule.jsx's
          // client-side overlap check, which skips the round trip to the
          // server for the common case and only relies on the server's
          // own 409 as a backstop for races).
          dispatch({ type: "OPEN_PROPOSE", proposeSheet: action.proposeSheet });
          return;
        }

        // Both proposal entry points land here. The quick sheet is the
        // degenerate case of the four-step flow: a window exactly one
        // stop long, no name, no rationale (feature spec §6.6). Keeping
        // them on one action means the 409 handling below is written once.
        case "PROPOSE_BLOCK": {
          if (!state.trip) return { ok: false };
          try {
            const contest = await api.proposeBlock(state.trip.id, {
              starts_at: action.startsAt,
              ends_at: action.endsAt,
              label: action.label ?? "",
              rationale: action.rationale ?? "",
              items: action.items,
              party: action.party ?? [],
            });
            await dispatchRef.current({ type: "REFRESH_PLANS_AND_ITEMS" });
            return { ok: true, contestId: contest.id };
          } catch (err) {
            const conflict = proposalConflict(err);
            if (conflict) return { ok: false, ...conflict };
            console.error("propose block failed", err);
            return { ok: false, error: apiMessage(err) };
          }
        }

        // Rewrite one candidate plan in an open vote: its stops, their
        // times, its name, its case. The plan's own hours never move —
        // every option spans exactly the contest's window — and the votes
        // cast for it are cleared server side
        // (backend/app/routers/contests.py::update_proposal).
        case "EDIT_PROPOSAL": {
          try {
            const contest = await api.updateProposal(action.planId, {
              label: action.label ?? "",
              rationale: action.rationale ?? "",
              items: action.items,
            });
            await dispatchRef.current({ type: "REFRESH_PLANS_AND_ITEMS" });
            return { ok: true, contest };
          } catch (err) {
            console.error("edit proposal failed", err);
            return { ok: false, error: apiMessage(err) };
          }
        }

        case "CONFIRM_PROPOSE": {
          const sheet = state.proposeSheet;
          if (!sheet || !state.trip) return { ok: false };
          const result = await dispatchRef.current({
            type: "PROPOSE_BLOCK",
            startsAt: action.startsAt,
            endsAt: action.endsAt,
            items: [sheet.kind === "pin" ? { pin_id: sheet.refId } : { travel_item_id: sheet.refId }],
            // Proposing against one branch of a split day is a decision
            // for that branch's people only (backend/app/routers/
            // contests.py open_block_contest).
            party: sheet.party ?? [],
          });
          if (result.ok) dispatch({ type: "CLOSE_PROPOSE" });
          return result;
        }

        // A draft block: the author's own, occupying no time, invisible to
        // everyone else until it's published (feature spec §6.4).
        // Re-saving one replaces it rather than PATCHing, because a draft
        // is a whole window plus a whole stop list — there's no partial
        // edit of it worth an endpoint of its own.
        //
        // New copy first, old one second. Deleting a plan deletes any
        // custom event nothing else holds (backend/app/custom_events.py),
        // so deleting the old draft first would take the custom events
        // this very save is about to reference with it. Drafts occupy no
        // time, so the two copies can't collide in between.
        case "SAVE_DRAFT": {
          if (!state.trip) return { ok: false };
          try {
            const plan = await api.createPlan(state.trip.id, {
              starts_at: action.startsAt,
              ends_at: action.endsAt,
              status: "draft",
              label: action.label ?? "",
              rationale: action.rationale ?? "",
              items: action.items,
              party: action.party ?? [],
            });
            if (action.replaceDraftId) await api.deletePlan(action.replaceDraftId);
            await dispatchRef.current({ type: "REFRESH_PLANS_AND_ITEMS" });
            return { ok: true, planId: plan.id };
          } catch (err) {
            console.error("save draft failed", err);
            return { ok: false, error: apiMessage(err) };
          }
        }

        case "PUBLISH_DRAFT": {
          try {
            const contest = await api.publishPlan(action.planId);
            await dispatchRef.current({ type: "REFRESH_PLANS_AND_ITEMS" });
            return { ok: true, contestId: contest.id };
          } catch (err) {
            const conflict = proposalConflict(err);
            if (conflict) return { ok: false, ...conflict };
            console.error("publish draft failed", err);
            return { ok: false, error: apiMessage(err) };
          }
        }

        case "DISCARD_DRAFT": {
          try {
            await api.deletePlan(action.planId);
            await dispatchRef.current({ type: "REFRESH_PLANS_AND_ITEMS" });
            return { ok: true };
          } catch (err) {
            console.error("discard draft failed", err);
            return { ok: false, error: err.message };
          }
        }

        // Split-party plans (lib/party.js). Each returns { ok } or
        // { ok: false, error } with the server's sentence, which names who
        // would be double-booked — the only part of a refusal a person can
        // act on.
        case "SPLIT_PLAN": {
          try {
            const [, branch] = await api.splitPlan(action.planId, { leaving: action.leaving, label: action.label ?? "" });
            await dispatchRef.current({ type: "REFRESH_PLANS_AND_ITEMS" });
            return { ok: true, branchPlanId: branch.id };
          } catch (err) {
            return { ok: false, error: apiMessage(err) };
          }
        }

        case "SET_PLAN_PARTY": {
          try {
            await api.setPlanParty(action.planId, action.party);
            await dispatchRef.current({ type: "REFRESH_PLANS_AND_ITEMS" });
            return { ok: true };
          } catch (err) {
            return { ok: false, error: apiMessage(err) };
          }
        }

        case "JOIN_PLAN": {
          try {
            await api.joinPlan(action.planId);
            await dispatchRef.current({ type: "REFRESH_PLANS_AND_ITEMS" });
            return { ok: true };
          } catch (err) {
            return { ok: false, error: apiMessage(err) };
          }
        }

        case "UNPLACE_PLAN": {
          try {
            await api.deletePlan(action.planId);
            await dispatchRef.current({ type: "REFRESH_PLANS_AND_ITEMS" });
            return { ok: true };
          } catch (err) {
            console.error("unplace failed", err);
            return { ok: false, error: err.message };
          }
        }

        // Direct lock/reopen on a plan with no contest attached (picking a
        // set in CompareSets.jsx doesn't lock anything — see
        // routers/contests.py pick_set; handleReopen there only matters
        // for decisions settled before that change). Both are
        // reversible from the same control, so neither needs a
        // confirmation step here, same as UNPLACE_PLAN above.
        case "LOCK_PLAN": {
          try {
            await api.lockPlan(action.planId);
            await dispatchRef.current({ type: "REFRESH_PLANS_AND_ITEMS" });
            return { ok: true };
          } catch (err) {
            console.error("lock failed", err);
            return { ok: false, error: err.message };
          }
        }

        case "REOPEN_PLAN": {
          try {
            await api.reopenPlan(action.planId);
            await dispatchRef.current({ type: "REFRESH_PLANS_AND_ITEMS" });
            return { ok: true };
          } catch (err) {
            console.error("reopen failed", err);
            return { ok: false, error: err.message };
          }
        }

        case "CREATE_TRAVEL_ITEM": {
          const created = await api.createTravelItem(state.trip.id, action.payload);
          const contributorsById = Object.fromEntries(state.contributors.map((c) => [c.id, c]));
          const item = normalizeTravelItem(created, contributorsById);
          dispatch({ type: "APPLY_TRAVEL_ITEM", item });
          return item;
        }

        case "PATCH_TRAVEL_ITEM": {
          const updated = await api.patchTravelItem(action.id, action.fields);
          const contributorsById = Object.fromEntries(state.contributors.map((c) => [c.id, c]));
          const item = normalizeTravelItem(updated, contributorsById);
          dispatch({ type: "APPLY_TRAVEL_ITEM", item });
          return item;
        }

        case "DELETE_TRAVEL_ITEM": {
          try {
            await api.deleteTravelItem(action.id);
            dispatch({ type: "REMOVE_TRAVEL_ITEM", id: action.id });
            return { ok: true };
          } catch (err) {
            console.error("delete travel item failed", err);
            return { ok: false, error: err.message };
          }
        }

        // Permanently deletes the pin itself (backend/app/routers/pins.py) —
        // distinct from UNPLACE_PLAN above, which only removes the Plan/
        // PlanItem and leaves the pin sitting unscheduled in the tray. (A
        // custom event doesn't go back to the tray: unplacing deletes it —
        // backend/app/custom_events.py.) The
        // backend rejects this with 409 while any PlanItem still points at
        // the pin, so callers (components/planner/PlanDetailsSheet.jsx)
        // unplace first when deleting something currently on the calendar.
        case "DELETE_PIN": {
          try {
            await api.deletePin(action.id);
            dispatch({ type: "REMOVE_PIN", id: action.id });
            return { ok: true };
          } catch (err) {
            if (err.status === 409) {
              return { ok: false, scheduled: true };
            }
            console.error("delete pin failed", err);
            return { ok: false, error: err.message };
          }
        }

        case "CREATE_TRIP": {
          // Trip creation always goes through the API (there's no local
          // fallback) — the new trip needs a real id before anything else
          // can reference it. On success, fold it into "otherTrips" the
          // same shape load() builds them in; making a new trip the active
          // TRIP when there already is one is out of scope here, same as
          // the rest of "Also planning". The one exception is the very
          // first trip — see below.
          const trip = await api.createTrip(action.payload);
          if (!state.trip) {
            // First trip in an empty database (see emptyTripView above).
            // There's no active trip for this one to sit "also planning"
            // beside, and filing it there would strand the user on the
            // very empty state they just acted on. Open it properly
            // instead — the same load OPEN_TRIP performs.
            const trips = await api.listTrips();
            const payload = await loadTripView(trip.id, trips);
            dispatch({ type: "LOADED", payload });
            return trip;
          }
          dispatch({
            type: "ADD_TRIP",
            trip: {
              id: trip.id,
              name: trip.name,
              meta: "0 pins · 1 planning",
              ownership: "Your trip",
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
              travellerCount: updated.traveller_count ?? null,
            },
          });
          return updated;
        }

        case "OPEN_TRIP": {
          // Makes another "also planning" trip the active TRIP (see
          // TripsHome), so its own pins/contributors/plans back
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

        case "PATCH_PIN": {
          const backendFields = {};
          const f = action.fields;
          if ("title" in f) backendFields.title = f.title;
          if ("region" in f) backendFields.region = f.region;
          if ("dur" in f) backendFields.duration_minutes = f.dur;
          if ("cost" in f) backendFields.cost_cents = Math.round(f.cost * 100);
          if ("notes" in f) backendFields.notes = f.notes;
          if ("link" in f) backendFields.link = f.link;
          if ("tags" in f) backendFields.tags = f.tags;
          if ("heads" in f) backendFields.heads = f.heads;
          // A pasted replacement URL, or a cleared field going back to
          // "no photo" — either way sent as photo_url, same as create
          // (pages/NewPin.jsx); routers/pins.py re-mirrors it into blob
          // storage whenever this lands a new external link.
          if ("photoUrl" in f) backendFields.photo_url = f.photoUrl.trim() || null;
          // Returns a result rather than swallowing the failure: an
          // explicit Save (pages/EditVisit.jsx) has to be able to keep the
          // user on the form and say so when the write didn't land, instead
          // of navigating away as if it had. Callers that only fire off a
          // background sync (components/planner/PlanDetailsSheet.jsx) can
          // still ignore what comes back.
          try {
            const updated = await api.patchPin(action.id, backendFields);
            const contributorsById = Object.fromEntries(state.contributors.map((c) => [c.id, c]));
            const pin = normalizePin(updated, contributorsById);
            dispatch({ type: "APPLY_PIN", pin });
            return { ok: true, pin };
          } catch (err) {
            console.error("pin update failed", err);
            return { ok: false, error: err.message };
          }
        }

        // Flips one availability cell for one pin. The endpoint is a
        // toggle, not a set, so a caller holding a draft of the grid
        // (pages/EditVisit.jsx) sends one of these per cell that actually
        // differs from what's stored — see its commitOverrides. Reports
        // ok/error for the same reason PATCH_PIN does.
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
            return { ok: true, overridden: result.overridden };
          } catch (err) {
            console.error("availability override failed", err);
            return { ok: false, error: err.message };
          }
        }

        default:
          return;
      }
    },
    [state.pins, state.travelItems, state.plans, state.placing, state.proposeSheet, state.contributors, state.trip]
  );
  // Stable function identity across renders (children never need to
  // re-subscribe just because a background fetch resolved).
  const stableDispatch = useMemo(() => (action) => dispatchRef.current(action), []);

  const value = useMemo(() => state, [state]);

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

// Whether the viewer holds `scope` on the active trip — e.g.
// can("ideas:write"), can("costs:read"). The server enforces every one of
// these on its own; this is only for not offering what would be refused.
export function useCan() {
  const { trip } = usePlannerState();
  const scopes = trip?.scopes;
  return useMemo(() => {
    const set = new Set(scopes ?? []);
    return (scope) => set.has(scope);
  }, [scopes]);
}

// Per-item access for pins and travel items, on top of useCan(): a
// companion (ideas:add, costs:own) may change, and see the cost of, only
// what they added themselves; a planner (ideas:write, costs:read/write)
// any of it. `item` is a normalized pin or travel item — pass null for
// one the viewer is about to create, which will be theirs.
export function useIdeaAccess() {
  const can = useCan();
  const { currentUserId } = usePlannerState();
  return useMemo(() => {
    const mine = (item) => item == null || (item.who != null && item.who === currentUserId);
    return {
      canAddIdeas: can("ideas:add"),
      canEditIdea: (item) => can("ideas:write") || (can("ideas:add") && mine(item)),
      canSeeCost: (item) => can("costs:read") || (can("costs:own") && mine(item)),
      canSetCost: (item) => can("costs:write") || (can("costs:own") && mine(item)),
    };
  }, [can, currentUserId]);
}

export function useCurrentUser() {
  const { contributors, currentUserId } = usePlannerState();
  return (
    contributors.find((c) => c.id === currentUserId) ??
    contributors[0] ?? { id: null, name: "You", initial: "?", tint: "var(--who-1)", isOwner: false }
  );
}
