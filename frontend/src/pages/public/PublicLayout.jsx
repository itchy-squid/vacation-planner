import "./public.css";

// Shared frame for the public, signed-out pages (Home.jsx,
// PrivacyPolicy.jsx): a header with the logo and a footer with the legal
// links. main.jsx renders these pages without the app shell or the
// sign-in gate, so they stay reachable by anyone — Google's OAuth brand
// verification needs a public homepage and privacy policy on our domain.

// The favicon's mark (public/favicon.svg): three itinerary lines, the
// middle one short and in the accent.
export function Logo({ size = 28, onDark = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      <path fill={onDark ? "#33323a" : "#17171a"} d="M1 0h14v1h1v14h-1v1H1v-1H0V1h1z" />
      {!onDark && (
        <>
          <rect x="2" y="4" width="1" height="2" fill="#6f6f78" />
          <rect x="2" y="7" width="1" height="2" fill="#6f6f78" />
          <rect x="2" y="10" width="1" height="2" fill="#6f6f78" />
        </>
      )}
      <rect x="4" y="4" width="8" height="2" fill="#f4f4f5" />
      <rect x="4" y="7" width="5" height="2" fill="#d2679e" />
      <rect x="4" y="10" width="8" height="2" fill="#f4f4f5" />
    </svg>
  );
}

// `links` are the in-page anchors, shown from 960px up; the Sign in pill
// is always there. On the homepage it jumps to the sign-in buttons; on
// other pages it goes to the homepage's.
export function PublicHeader({ links = [], signInHref = "/#signin" }) {
  return (
    <header className="pub-header">
      <div className="pub-wrap">
        <a href="/" className="pub-brand">
          <Logo />
          Vacation Planner
        </a>
        <nav aria-label="Main" className="pub-nav">
          {links.map(({ href, label }) => (
            <a key={href} href={href} className="pub-nav-link">
              {label}
            </a>
          ))}
          <a href={signInHref} className="pub-pill">
            Sign in
          </a>
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="pub-footer">
      <div className="pub-wrap">
        <div className="pub-footer-left">
          <div className="pub-footer-brand">
            <Logo size={24} onDark />
            Vacation Planner
          </div>
          <div className="pub-footer-copy">© {new Date().getFullYear()} Vacation Planner</div>
        </div>
        <nav aria-label="Footer">
          <a href="/privacy">Privacy policy</a>
        </nav>
      </div>
    </footer>
  );
}
