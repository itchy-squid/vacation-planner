import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import PinCard from "../components/planner/PinCard";
import { usePlannerState, useCan } from "../state/PlannerContext";
import RoleTag from "../components/core/RoleTag";
import TripHeader from "../components/core/TripHeader";
import HeaderIconButton from "../components/core/HeaderIconButton";
import EmptyBoard from "../components/planner/EmptyBoard";
import InviteSheet from "../components/sharing/InviteSheet";
import RegionFilter, { ALL_REGIONS } from "../components/planner/RegionFilter";
import { regionKey } from "../lib/regions";
import { coversEveryone, passesByPin } from "../lib/expenseTypes";

// Screen 2 — "collect candidate places." Handoff README screen 2. The
// Board/Map segment switch is gone: the map is its own tab now
// (pages/TripMap.jsx). Filtering is local UI state only in this pass.
// The "+" opens pages/NewPin.jsx, which starts with place search. A pin
// just added there comes back first on the board, outlined, with a short
// confirmation (navigation state `addedPinId`). With no pins
// yet the board is components/planner/EmptyBoard.jsx instead, which says
// what the board is for and carries the ways to start (and the invite
// sheet, for the owner) — so the "+" is hidden there rather than offered
// twice.
export default function PinBoard() {
  const navigate = useNavigate();
  const { trip: TRIP, pins, costs, travelers, contributors: CONTRIBUTORS, regions: REGION_LOCATIONS } = usePlannerState();
  // Tickets and rentals aren't on the board (they're kept in Expenses,
  // state.costs); a ticket shows only as a badge on the places it covers.
  const passes = useMemo(() => passesByPin(costs), [costs]);
  // Companions and planners both add pins (ideas:add); what each may do
  // to an existing one is decided on its own screen (pages/EditVisit.jsx).
  const can = useCan();
  const canEdit = can("ideas:add");
  const [region, setRegion] = useState(ALL_REGIONS);
  const [inviting, setInviting] = useState(false);

  // The pin pages/NewPin.jsx just added, if that's how we got here. Read
  // once: the history entry is cleared straight away so a reload or a
  // return visit doesn't announce it again, but the card stays outlined
  // for as long as this screen is open.
  const location = useLocation();
  const [justAddedId] = useState(() => location.state?.addedPinId ?? null);
  const [announcing, setAnnouncing] = useState(justAddedId != null);
  useEffect(() => {
    if (justAddedId == null) return undefined;
    navigate(location.pathname, { replace: true, state: null });
    const timer = setTimeout(() => setAnnouncing(false), 4000);
    return () => clearTimeout(timer);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const PINS = useMemo(() => Object.values(pins), [pins]);

  // The filter's regions are the trip's actual pin regions (from the
  // backend), not a fixed list — alphabetical so the order is stable
  // regardless of pin insertion order or which trip is active. Counts are
  // for the region sheet a long list collapses into.
  const REGIONS = useMemo(() => {
    const counts = new Map();
    PINS.forEach((p) => {
      if (p.region) counts.set(p.region, (counts.get(p.region) ?? 0) + 1);
    });
    return [...counts]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [PINS]);

  // If the active trip changes (see PlannerContext's OPEN_TRIP) and the
  // selected region filter no longer exists on it, fall back to "All"
  // rather than silently showing zero pins.
  useEffect(() => {
    if (region !== ALL_REGIONS && !REGIONS.some((r) => r.name === region)) setRegion(ALL_REGIONS);
  }, [REGIONS, region]);

  const filtered = useMemo(() => {
    const shown = region === ALL_REGIONS ? PINS : PINS.filter((p) => p.region === region);
    const added = shown.find((p) => p.id === justAddedId);
    return added ? [added, ...shown.filter((p) => p !== added)] : shown;
  }, [region, PINS, justAddedId]);
  const justAdded = justAddedId != null ? pins[justAddedId] : null;

  const columns = [[], []];
  filtered.forEach((pin, i) => columns[i % 2].push(pin));

  const initialFor = (pin) => CONTRIBUTORS.find((c) => c.id === pin.who)?.initial ?? "?";
  // Where each card will be on the Map tab: at its own spot, or in its
  // region once the trip knows where that region is.
  const locationLabelFor = (pin) => {
    if (pin.lat != null) return "On the map";
    return pin.region && REGION_LOCATIONS[regionKey(pin.region)] ? `Shown in ${pin.region}` : null;
  };
  // "+" and "Type a place" go to place search (pages/NewPin.jsx; without a
  // Maps key that's the by-hand form, starting in the title). "Paste a
  // link" goes straight to the by-hand form.
  const newPin = (query = "") => navigate(`/trips/${TRIP.id}/new-pin${query}`);
  const isEmpty = PINS.length === 0;

  if (isEmpty) {
    return (
      <div className="screen">
        <div className="screen-scroll" style={{ paddingBottom: 24 }}>
          <TripHeader />
          <div style={{ height: 14 }} />
          <EmptyBoard
            canAdd={canEdit}
            canInvite={can("members:manage")}
            ownerName={TRIP.owner?.name}
            onAddLink={() => newPin("?mode=link")}
            onAddPlace={() => newPin("?focus=title")}
            onInvite={() => setInviting(true)}
          />
        </div>
        {inviting ? <InviteSheet trip={TRIP} onClose={() => setInviting(false)} /> : null}
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="screen-scroll" style={{ paddingBottom: 24 }}>
        {/* The trip's name lives in the header now, so this screen's own
            heading would only repeat it — what's left is the line that
            says something the header doesn't. */}
        <TripHeader
          right={
            canEdit ? (
              <HeaderIconButton
                glyph="+"
                label="Add pin"
                glyphSize={20}
                onClick={() => newPin()}
              />
            ) : null
          }
        />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px var(--gutter-text) 12px" }}>
          <div className="mono-caption">{PINS.length} pin{PINS.length === 1 ? "" : "s"}</div>
          {canEdit ? null : <RoleTag role="reader">View only</RoleTag>}
        </div>

        <RegionFilter regions={REGIONS} total={PINS.length} value={region} onChange={setRegion} />

        {announcing && justAdded ? (
          <div
            role="status"
            style={{ margin: "0 var(--gutter-screen) 12px", padding: "10px 12px", borderRadius: "var(--radius-lg)", background: "var(--surface-inverse)", color: "#fff", font: "500 12.5px/1.4 var(--font-sans)" }}
          >
            <b style={{ fontWeight: 600 }}>{justAdded.title}</b> added to ideas.
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 10, padding: "0 var(--gutter-screen)" }}>
          {columns.map((col, ci) => (
            <div key={ci} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
              {col.map((pin) => (
                <PinCard
                  key={pin.id}
                  pin={pin}
                  column={ci}
                  contributorInitial={initialFor(pin)}
                  highlighted={pin.id === justAddedId}
                  locationLabel={locationLabelFor(pin)}
                  pass={passes.get(pin.id)?.[0] ?? null}
                  passCoversAll={passes.has(pin.id) && coversEveryone(passes.get(pin.id), travelers)}
                  onOpen={() => navigate(`/trips/${TRIP.id}/edit/${pin.id}?from=board`)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
