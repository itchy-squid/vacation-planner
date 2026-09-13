import { NavLink, matchPath, useLocation } from "react-router-dom";
import { usePlannerState } from "../../state/PlannerContext";
import { useGuardedNavigate, useIsNavGuarded } from "../../state/NavGuard";

// The app's trip-level bottom navigation — the one place every main screen
// is reachable from. It started as review-only scaffolding (src/dev/DevNav)
// because the handoff had no tab bar in it; it's now permanent, so treat it
// as real navigation when adding or renaming a screen.
//
// Context-sensitive: the bar is about moving around *one trip*, so it only
// exists once you're inside one. Trips Home (and the new-trip form) are
// trip-agnostic — there's no trip to have a Board or a Schedule of yet, and
// the choice to make there is which trip to open, which that screen's own
// cards and its "Open board" / "Start schedule" buttons already are. So
// nothing renders there at all: an empty bar would read as a broken one.
// Picking a trip on Trips Home lands on a trip-scoped screen, and the tabs
// appear with it.
//
// That also removes the need for a "Home" tab: every screen this bar shows
// on already carries its own way back to Trips Home — the back chevron in
// components/core/TripHeader.jsx, which all five of them wear — and a fifth
// tab spends scarce width restating it.
//
// Trip-scoped screens live under /trips/:tripId/... (see App.jsx), so these
// links point at whichever trip is currently loaded. There's no fixed
// "/compare" route — any number of contests can be open at once (see
// docs/features/scheduling-feature-spec.md), so Compare jumps to whichever
// one is open first and is hidden when none are.
//
// The Lasso Map (pages/LassoMap.jsx, /trips/:tripId/map) is deliberately
// not listed: it's still routed and reachable by URL, but nothing links to
// it while it's out of the main flow. It does get the bar, though — it's a
// main trip screen, not a modal-style one.

// Where the bar belongs: the trip's main screens. Everything else is
// either trip-agnostic (Trips Home, new trip) or one of the modal-style
// flows that sit *over* a trip with their own Cancel/Save and no business
// offering a tab that discards the form — new pin, edit visit, trip
// settings (see pages/EditVisit.jsx, whose draft the tab bar would
// otherwise be one stray tap from losing).
const MAIN_SCREEN_PATHS = [
  "/trips/:tripId/board",
  "/trips/:tripId/map",
  "/trips/:tripId/schedule",
  "/trips/:tripId/schedule/:day",
  "/trips/:tripId/contests/:contestId",
  "/trips/:tripId/itinerary",
];

export default function BottomNav() {
  const { trip, plans } = usePlannerState();
  const { pathname } = useLocation();
  const guardedNavigate = useGuardedNavigate();
  const isGuarded = useIsNavGuarded();

  // No trips in the database yet (see PlannerContext's emptyTripView):
  // every link below is trip-scoped, so there's nothing to point at.
  if (!trip) return null;
  if (!MAIN_SCREEN_PATHS.some((path) => matchPath(path, pathname))) return null;

  const base = `/trips/${trip.id}`;
  const firstOpenContestId = plans.find((p) => p.status === "contested")?.contestId ?? null;

  // `to` is where a tab goes; `match` is what counts as being there. They
  // differ for Schedule, which always jumps to day 1 but has to stay lit
  // on day 3 — NavLink's own isActive compares against `to` alone, so it
  // would leave the bar with nothing highlighted on the screen the user is
  // most often looking at.
  const LINKS = [
    { to: `${base}/board`, label: "Board", match: ["/trips/:tripId/board"] },
    { to: `${base}/schedule/1`, label: "Schedule", match: ["/trips/:tripId/schedule", "/trips/:tripId/schedule/:day"] },
    firstOpenContestId
      ? { to: `${base}/contests/${firstOpenContestId}`, label: "Compare", match: ["/trips/:tripId/contests/:contestId"] }
      : null,
    { to: `${base}/itinerary`, label: "Final", match: ["/trips/:tripId/itinerary"] },
  ].filter(Boolean);

  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 999,
        display: "flex",
        justifyContent: "center",
        gap: 1,
        background: "#111",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {LINKS.map((l) => {
        const active = l.match.some((path) => matchPath(path, pathname));
        return (
          <NavLink
            key={l.to}
            to={l.to}
            // These stay real <a>s — middle-click, ⌘-click and "open in new
            // tab" keep working untouched. Only a plain left-click while
            // something on screen has an unsaved draft (see
            // state/NavGuard.jsx) is intercepted. No main screen holds one
            // today — the screens that do are the modal-style flows this
            // bar no longer appears on — so this is here so that a future
            // main screen with a draft can't be silently discarded by a
            // tab tap.
            onClick={(e) => {
              if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              if (!isGuarded()) return;
              e.preventDefault();
              guardedNavigate(l.to);
            }}
            style={{
              padding: "6px 12px",
              fontSize: 15,
              color: active ? "#8f4478" : "rgba(255,255,255,.6)",
              textDecoration: "none",
            }}
          >
            {l.label}
          </NavLink>
        );
      })}
    </div>
  );
}
