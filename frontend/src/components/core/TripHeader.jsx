import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronLeft } from "@fortawesome/free-solid-svg-icons";
import { usePlannerState } from "../../state/PlannerContext";
import { useGuardedNavigate } from "../../state/NavGuard";
import SettingsButton from "./SettingsButton";
import HeaderIconButton from "./HeaderIconButton";

// The one header every trip screen wears: back to Trips Home, the name of
// the trip you're in, and the gear for that trip's settings.
//
// It replaces the ☰ menu that used to sit in the corner of Board, Map and
// Schedule (and the one-off ⌂ buttons on Compare and Final). The menu held
// three items behind a tap — "Trips home", "Trip settings", "Sign out" —
// and the first two are the whole reason anyone opened it, so they're now
// just there: a back chevron and a gear, no tap to discover them. Sign out
// moved to Trips Home (pages/TripsHome.jsx), which is where you end up when
// you're finished with a trip rather than mid-way through one.
//
// Back goes to Trips Home rather than through history: these five screens
// reach each other freely through the tab bar (components/core/BottomNav.jsx),
// so "back" as "the previous screen" could be any of them and would read as
// a different destination every time. Home is the one place that's always up
// from here.
//
// Two variants. The default sits at the top of a normal screen. `floating`
// is for the two screens whose map runs full-bleed to the top edge
// (pages/LassoMap.jsx, pages/CompareSets.jsx): the same row, wrapped in the
// translucent card those screens already use for their floating controls,
// because a chromeless glyph over an arbitrary map tile is a coin toss for
// legibility. The buttons themselves stay chromeless in both.
// `right` takes a screen's own header action, dropped in just before the
// gear so the top-right corner stays the settings button. Pass a
// HeaderIconButton so it reads as the same kind of control rather than a
// second style of button in the same row — pages/PinBoard.jsx's "+" is the
// one that does.
export default function TripHeader({ floating = false, right = null, style }) {
  const navigate = useGuardedNavigate();
  const { trip } = usePlannerState();
  if (!trip) return null;

  const shell = floating
    ? {
        background: "rgba(255,255,255,.95)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-select)",
        padding: "0 4px",
      }
    : {
        // Icon buttons sit closer to the screen edge than text does — the
        // glyph is optically centred in a 44px target, so matching the
        // 20px text gutter here would push the whole row inwards.
        padding: "6px 8px 0",
      };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, flex: "none", ...shell, ...style }}>
      {/* The "‹" text glyph used to need a manual translateY nudge to sit
          optically centered (font metrics put it high in its em box); a
          real SVG icon centers correctly on its own via this button's own
          flex centering, so that offset is gone. */}
      <HeaderIconButton glyph={<FontAwesomeIcon icon={faChevronLeft} style={{ width: 15, height: 15 }} />} label="Back to Trips home" onClick={() => navigate("/")} glyphSize={24} />
      <div
        className="serif-place"
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 21,
          lineHeight: 1.2,
          color: "var(--text-primary)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {trip.name}
      </div>
      {right}
      <SettingsButton />
    </div>
  );
}

