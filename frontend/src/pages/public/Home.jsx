import { AUTH_PROVIDERS, PROVIDER_LABELS, signIn } from "../../lib/api";
import { PublicFooter, PublicHeader } from "./PublicLayout";

// The public homepage: what a signed-out visitor sees at "/" (and anyone
// at "/about" — see main.jsx). Doubles as the homepage Google's OAuth
// brand verification checks, so it has to say plainly what the app does
// and what it does with Google account data, and link the privacy policy.
//
// Design: the "Vacation Planner Homepage" canvas (desktop + phone
// artboards). The sample day on the right is static illustration, not
// data.

const STEPS = [
  {
    title: "Pin what you want to do",
    body: "Everyone adds places to a shared board, with a photo and a note on why it’s worth the trip.",
  },
  {
    title: "Lay out the days",
    body: "Drop pins onto time blocks on each day of the trip to see what actually fits.",
  },
  {
    title: "Decide together",
    body: "When plans clash, compare options side by side on a map, vote and comment, then the trip owner locks it in.",
  },
  {
    title: "Split the costs",
    body: "Log shared expenses as you go so nobody has to chase anyone after the trip.",
  },
];

const POINTS = [
  {
    title: "We never see your password",
    body: "Google or Microsoft handles sign-in. We only get told who you are.",
  },
  {
    title: "No access to your email, files, contacts or calendar",
    body: "We don’t ask for them, so we can’t see them.",
  },
  {
    title: "Never sold or shared",
    body: "Your details are only shown to the people on your trips.",
  },
];

const FACES = ["var(--who-1)", "var(--who-2)", "var(--who-3)", "var(--who-4)"];

function Check() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function Lock() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function Slot({ time, desktopOnly = false, children }) {
  return (
    <div className={desktopOnly ? "pub-slot pub-slot--desktop" : "pub-slot"}>
      <div className="pub-slot-time">{time}</div>
      {children}
    </div>
  );
}

function Option({ letter, name, votes, share, lead = false }) {
  return (
    <div className="pub-option">
      <div className="pub-option-row">
        <span className="pub-option-letter">{letter}</span>
        <span className="pub-option-name">{name}</span>
        <span className="pub-option-votes">{votes}</span>
      </div>
      <div className={lead ? "pub-bar pub-bar--lead" : "pub-bar"}>
        <span style={{ width: share }} />
      </div>
    </div>
  );
}

// A made-up day mid-planning: something confirmed, a contested slot being
// voted on, a gap, and something locked.
function SampleDay() {
  return (
    <figure className="pub-preview" aria-label="Example: one day of a group trip being planned">
      <div className="pub-preview-head">
        <div>
          <div className="pub-eyebrow">Scheduling · 6 people</div>
          <div className="pub-preview-title">Day 2, Tuesday</div>
        </div>
        <div className="pub-faces" aria-hidden="true">
          {FACES.map((bg) => (
            <span key={bg} className="pub-face" style={{ background: bg }} />
          ))}
        </div>
      </div>
      <div className="pub-day">
        <Slot time="9:00">
          <div className="pub-block pub-block--confirmed">
            <span className="pub-block-name">Morning market</span>
            <span className="pub-block-status">Confirmed</span>
          </div>
        </Slot>
        <Slot time="11:00">
          <div className="pub-block pub-block--contest">
            <span className="pub-block-status">2 options · voting</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
              <Option letter="A" name="Lighthouse trail" votes="4 votes" share="66%" lead />
              <Option letter="B" name="Old town food tour" votes="2 votes" share="33%" />
            </div>
          </div>
        </Slot>
        <Slot time="14:00">
          <div className="pub-block pub-block--open">Open. Drop a pin here</div>
        </Slot>
        <Slot time="16:00">
          <div className="pub-block pub-block--locked">
            <span className="pub-block-name">Tide pools at low tide</span>
            <span className="pub-block-status">
              <Lock />
              Locked
            </span>
          </div>
        </Slot>
        <Slot time="19:30" desktopOnly>
          <div className="pub-block pub-block--confirmed">
            <span className="pub-block-name">Dinner by the harbor</span>
            <span className="pub-block-status">Confirmed</span>
          </div>
        </Slot>
      </div>
    </figure>
  );
}

export default function Home() {
  return (
    <div className="pub">
      <PublicHeader
        signInHref="#signin"
        links={[
          { href: "#how", label: "How it works" },
          { href: "#privacy", label: "Privacy" },
        ]}
      />

      <main>
        <section className="pub-wrap pub-hero">
          <div className="pub-hero-copy">
            <div className="pub-eyebrow pub-eyebrow--accent">Group trip planning</div>
            <h1 className="pub-h1">Plan your next trip together.</h1>
            <p className="pub-lede">
              Vacation Planner is a shared board for group trips. Collect the spots everyone wants to see, drop them
              onto the days of your trip, and settle the tough calls with side‑by‑side options and a quick vote.
            </p>
            <div id="signin" className="pub-signin">
              {AUTH_PROVIDERS.map((provider, i) => (
                <button
                  key={provider}
                  type="button"
                  onClick={() => signIn(provider)}
                  className={i === 0 ? "pub-btn pub-btn--primary" : "pub-btn pub-btn--secondary"}
                >
                  Sign in with {PROVIDER_LABELS[provider]}
                </button>
              ))}
            </div>
            <p className="pub-fineprint">No new password. Use an account you already have.</p>
          </div>
          <SampleDay />
        </section>

        <section id="how" className="pub-how">
          <div className="pub-wrap pub-section">
            <div className="pub-section-head">
              <div className="pub-eyebrow">How it works</div>
              <h2 className="pub-h2">From a pile of ideas to one itinerary</h2>
            </div>
            <ol className="pub-steps">
              {STEPS.map((step, i) => (
                <li key={step.title} className="pub-step">
                  <div className="pub-step-num">{String(i + 1).padStart(2, "0")}</div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="privacy" className="pub-wrap pub-section pub-privacy">
          <div className="pub-privacy-copy">
            <div className="pub-eyebrow pub-eyebrow--geo">Privacy</div>
            <h2 className="pub-h2">Your data stays with your trip.</h2>
            <p>
              When you sign in with Google or Microsoft, we get your name and email address. We use them to sign you
              in and to show your group who added each place, vote and expense.
            </p>
            <a href="/privacy" className="pub-textlink">
              Read the privacy policy →
            </a>
          </div>
          <ul className="pub-points">
            {POINTS.map((point) => (
              <li key={point.title} className="pub-point">
                <Check />
                <div>
                  <h3>{point.title}</h3>
                  <p>{point.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
