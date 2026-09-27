import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import PinCard from "../components/planner/PinCard";
import { usePlannerState, useCan } from "../state/PlannerContext";
import RoleTag from "../components/core/RoleTag";
import TripHeader from "../components/core/TripHeader";
import HeaderIconButton from "../components/core/HeaderIconButton";
import EmptyBoard from "../components/planner/EmptyBoard";
import InviteSheet from "../components/sharing/InviteSheet";
import RegionFilter, { ALL_REGIONS } from "../components/planner/RegionFilter";

// Screen 2 — "collect candidate places." Handoff README screen 2. The
// Board/Map segment switch is gone: the lasso map (pages/LassoMap.jsx) is
// out of the main flow, still routed but no longer linked from here or
// from the bottom nav. Filtering is local UI state only in this pass.
// The "+" opens pages/NewPin.jsx to add a pin from a link. With no pins
// yet the board is components/planner/EmptyBoard.jsx instead, which says
// what the board is for and carries the ways to start (and the invite
// sheet, for the owner) — so the "+" is hidden there rather than offered
// twice.
export default function PinBoard() {
  const navigate = useNavigate();
  const { trip: TRIP, pins, contributors: CONTRIBUTORS } = usePlannerState();
  // Companions and planners both add pins (ideas:add); what each may do
  // to an existing one is decided on its own screen (pages/EditVisit.jsx).
  const can = useCan();
  const canEdit = can("ideas:add");
  const [region, setRegion] = useState(ALL_REGIONS);
  const [inviting, setInviting] = useState(false);

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
    return region === ALL_REGIONS ? PINS : PINS.filter((p) => p.region === region);
  }, [region, PINS]);

  const columns = [[], []];
  filtered.forEach((pin, i) => columns[i % 2].push(pin));

  const initialFor = (pin) => CONTRIBUTORS.find((c) => c.id === pin.who)?.initial ?? "?";
  const newPin = (focus) => navigate(`/trips/${TRIP.id}/new-pin${focus ? `?focus=${focus}` : ""}`);
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
            onAddLink={() => newPin("link")}
            onAddPlace={() => newPin("title")}
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
          <div className="mono-caption">Ideation · {PINS.length} pins</div>
          {canEdit ? null : <RoleTag role="reader">View only</RoleTag>}
        </div>

        <RegionFilter regions={REGIONS} total={PINS.length} value={region} onChange={setRegion} />

        <div style={{ display: "flex", gap: 10, padding: "0 var(--gutter-screen)" }}>
          {columns.map((col, ci) => (
            <div key={ci} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
              {col.map((pin) => (
                <PinCard key={pin.id} pin={pin} column={ci} contributorInitial={initialFor(pin)} onOpen={() => navigate(`/trips/${TRIP.id}/edit/${pin.id}?from=board`)} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
