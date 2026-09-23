import { useEffect, useState } from "react";
import Button from "../components/core/Button";

// What's on screen while main.jsx waits on the session check (GET /api/me)
// before it knows whether to render the app, the public homepage or send
// the browser to sign in.
//
// That check is usually instant, but the backend scales to zero when idle
// (infra/modules/container-app-backend.bicep, minReplicas: 0) and Easy
// Auth runs inside the same replica, so the first request after a quiet
// spell -- even one that's only going to be told "401, sign in again" --
// waits out a full cold start. This screen exists so that wait reads as
// "the app is waking up" rather than as a blank, hung page.
//
// index.html carries a static copy of the first stage (same markup, same
// .boot-* classes, styled inline there), so something is on screen before
// any JS has even downloaded; this component takes over from it and
// escalates the copy the longer the wait goes on.
const WAKING_AFTER_MS = 2500;
const SLOW_AFTER_MS = 45000;
const RETRY_AFTER_MS = 90000;

export function BootMark() {
  // The favicon's three itinerary lines, one still in play.
  return (
    <div className="boot-mark" aria-hidden="true">
      <span className="boot-line" />
      <span className="boot-line boot-line-live" />
      <span className="boot-line" />
    </div>
  );
}

export default function BootScreen({ phase = "checking" }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => setElapsed(Date.now() - started), 500);
    return () => window.clearInterval(id);
  }, []);

  let title = null;
  let detail = null;
  if (phase === "signingIn") {
    title = "Signing you in…";
    detail = "Your session ran out, so you’re headed back to your sign-in page.";
  } else if (elapsed >= SLOW_AFTER_MS) {
    title = "Still waking up…";
    detail = "Taking longer than usual. Reloading won’t speed it up — it’s picking up the same start.";
  } else if (elapsed >= WAKING_AFTER_MS) {
    title = "Waking up the server…";
    detail = "Vacation Planner naps when nobody’s using it. The first visit after a quiet spell takes a little longer — usually under a minute.";
  }

  return (
    <main className="boot" role="status" aria-live="polite">
      <BootMark />
      {title ? (
        <div className="boot-copy">
          <h1 className="boot-title">{title}</h1>
          <p className="boot-detail">{detail}</p>
        </div>
      ) : (
        <div className="mono-caption boot-caption">Loading…</div>
      )}
      {phase === "checking" && elapsed >= RETRY_AFTER_MS && (
        <Button variant="secondary" fullWidth={false} style={{ minWidth: 240 }} onClick={() => window.location.reload()}>
          Try again
        </Button>
      )}
    </main>
  );
}
