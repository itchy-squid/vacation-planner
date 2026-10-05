import { NavLink } from "react-router-dom";

// The tab bar outside any trip: Trips | People | You. Trip screens have
// their own bar (components/core/BottomNav.jsx), about moving around one
// trip; this one is about you — which trip to open, who you plan with,
// and your account. Opening a trip swaps one bar for the other, and the
// trip header's back chevron comes back here.
//
// Rendered by each of the three screens at the foot of its own column,
// rather than fixed to the window like BottomNav, so it takes up real
// space (nothing scrolls under it) and stays inside .app-viewport on a
// desktop-width window.
const TABS = [
  { to: "/", label: "Trips", icon: SuitcaseIcon, end: true },
  { to: "/people", label: "People", icon: PeopleIcon },
  { to: "/you", label: "You", icon: YouIcon },
];

export default function HomeTabBar() {
  return (
    <nav
      aria-label="Main"
      style={{
        flex: "none",
        display: "flex",
        background: "var(--surface-card)",
        borderTop: "1px solid var(--hairline)",
        padding: "6px 8px calc(10px + env(safe-area-inset-bottom, 0px))",
      }}
    >
      {TABS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          style={({ isActive }) => ({
            flex: 1,
            minHeight: "var(--hit-min)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 3,
            font: "600 11px var(--font-sans)",
            color: isActive ? "var(--accent)" : "var(--text-secondary)",
            textDecoration: "none",
          })}
        >
          <Icon />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

const ICON = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

function SuitcaseIcon() {
  return (
    <svg {...ICON}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg {...ICON}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <circle cx="17" cy="9" r="2.6" />
      <path d="M16 13.6c2.9.2 5 2.2 5 5" />
    </svg>
  );
}

function YouIcon() {
  return (
    <svg {...ICON}>
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M5 20c.6-3.6 3.5-6 7-6s6.4 2.4 7 6" />
    </svg>
  );
}
