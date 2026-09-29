import { useCallback, useEffect, useRef, useState } from "react";
import { MODES } from "../../lib/routes";
import { estimateLeg } from "../../lib/routeEstimates";

/**
 * Google's estimate of every way to make each ride in `legs`
 * ([{ key, from, to }], from/to with lat and lng), asked once per ride and
 * departure:
 *
 *   estimates[key] = { status: "loading" }
 *                  | { status: "ready", byMode: { car: readRoute(), … } }
 *                  | { status: "error" }   (Google couldn't answer; retry)
 *
 * A single mode failing reads as that mode being unavailable, so one bad
 * answer doesn't hide the others; with no way found and a failure among
 * them, it's an error, since the failure may be why. `departure` times the transit modes;
 * changing it (another day of the week) asks again.
 */
export function useRideEstimates(legs, departure) {
  const [answers, setAnswers] = useState({}); // `${key}@${departure}` -> estimate
  const [attempt, setAttempt] = useState(0);
  const requested = useRef(new Set()); // `${key}@${departure}` asked, or being asked
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const when = departure ? departure.getTime() : 0;
  const keys = legs.map((l) => l.key).join(",");

  useEffect(() => {
    legs.forEach(({ key, from, to }) => {
      const asked = `${key}@${when}`;
      if (requested.current.has(asked)) return;
      requested.current.add(asked);
      const put = (value) => {
        if (live.current) setAnswers((current) => ({ ...current, [asked]: value }));
      };
      put({ status: "loading" });
      Promise.allSettled(MODES.map((mode) => estimateLeg(from, to, mode, { departure }))).then((settled) => {
        const failed = settled.some((s) => s.status === "rejected");
        // Asked again on retry: the answers that came back are remembered
        // (lib/routeEstimates.js), so only the failures cost anything.
        if (failed) requested.current.delete(asked);
        if (failed && !settled.some((s) => s.status === "fulfilled" && s.value.available)) {
          put({ status: "error" });
          return;
        }
        const byMode = Object.fromEntries(
          settled.map((s, i) => [MODES[i], s.status === "fulfilled" ? s.value : { available: false, reason: "Couldn’t get a time" }])
        );
        put({ status: "ready", byMode });
      });
    });
    // `legs` is rebuilt on every render; its keys and the departure are
    // what decide what to ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, when, attempt]);

  const estimates = Object.fromEntries(legs.map(({ key }) => [key, answers[`${key}@${when}`] ?? { status: "loading" }]));
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { estimates, retry };
}
