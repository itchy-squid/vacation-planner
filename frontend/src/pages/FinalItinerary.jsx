import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRight } from "@fortawesome/free-solid-svg-icons";
import AvatarStack from "../components/planner/AvatarStack";
import { usePlannerState } from "../state/PlannerContext";
import TripHeader from "../components/core/TripHeader";
import { fmtMin } from "../data/derive";
import { getTripDays, tripDayLabel } from "../data/trip";
import { dayIndexForDate, clockLabel } from "../lib/planTime";

// Screen 7 — "read the locked plan," now data-driven across every day of
// the trip instead of a fixed FINISHED_DAYS mock with Day 5 special-
// cased. A day reads as settled once it has at least one placed/
// pencilled/locked plan and no open contest; a day with an open contest
// or nothing scheduled yet shows as unfinished with a resume link. See
// docs/features/scheduling-feature-spec.md "Locking".
//
// Stop times come from each item's startMinuteOfDay, computed once on the
// server. This screen used to pace them 12 minutes apart while the compare
// screen used 10 — one itinerary, two clocks. See backend/app/derive.py.
export default function FinalItinerary() {
  const navigate = useNavigate();
  const state = usePlannerState();
  const { trip: TRIP, plans, contributors } = state;

  const tripDays = useMemo(() => getTripDays(TRIP.startDate, TRIP.endDate), [TRIP.startDate, TRIP.endDate]);

  const dayViews = useMemo(() => {
    return tripDays.map((_, i) => {
      const dayIndex = i + 1;
      const dayPlans = plans
        .filter((p) => p.startDt && dayIndexForDate(p.startDt, TRIP.startDate) === dayIndex)
        .sort((a, b) => a.startDt.minuteOfDay - b.startDt.minuteOfDay);
      const hasOpenContest = dayPlans.some((p) => p.status === "contested");
      const settledPlans = dayPlans.filter((p) => p.status === "placed" || p.status === "pencilled" || p.status === "locked");

      const stops = [];
      settledPlans.forEach((p) => {
        p.items.forEach((item) => {
          stops.push({
            time: clockLabel(item.startMinuteOfDay ?? p.startDt.minuteOfDay),
            sortKey: item.startMinuteOfDay ?? p.startDt.minuteOfDay,
            title: item.title,
            detail: item.costCents
              ? `${fmtMin(item.durationMinutes)} · $${Math.round(item.costCents / 100)}`
              : fmtMin(item.durationMinutes),
            notable: p.status === "pencilled",
          });
        });
      });
      // A captured incumbent carries explicit offsets, so its stops are
      // not necessarily in plan order — sort by the clock, which is the
      // order a day is actually read in.
      stops.sort((a, b) => a.sortKey - b.sortKey);

      return {
        dayIndex,
        label: tripDayLabel(dayIndex, TRIP.startDate, TRIP.endDate),
        stops,
        settled: !hasOpenContest && settledPlans.length > 0,
        hasOpenContest,
        firstContestId: dayPlans.find((p) => p.status === "contested")?.contestId ?? null,
      };
    });
  }, [tripDays, plans, TRIP.startDate, TRIP.endDate]);

  const finishedCount = dayViews.filter((d) => d.settled).length;

  return (
    <div className="screen">
      <div className="screen-scroll" style={{ paddingBottom: 32 }}>
        <TripHeader />
        {/* The trip's name is in the header now — what stays here is how far
            through it the group actually is. */}
        <div style={{ padding: "6px var(--gutter-text) 0" }}>
          <div className="mono-caption">{finishedCount} of {dayViews.length || 1} days set</div>
          <div style={{ font: "400 13px var(--font-sans)", color: "var(--text-secondary)", marginTop: 4 }}>{TRIP.regionLine}</div>
          <div style={{ marginTop: 12, height: 6, borderRadius: 999, background: "var(--surface-sunken)", overflow: "hidden" }}>
            <div style={{ width: `${dayViews.length ? (finishedCount / dayViews.length) * 100 : 0}%`, height: "100%", background: "var(--geo)" }} />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "18px var(--gutter-screen) 0" }}>
          {dayViews.map((d) =>
            d.settled ? (
              <DayCard key={d.dayIndex} label={d.label} stops={d.stops} contributors={contributors} />
            ) : (
              <UnfinishedCard
                key={d.dayIndex}
                label={d.label}
                place={d.hasOpenContest ? "Still being decided by the group" : "Nothing scheduled yet"}
                // Only the plain "nothing scheduled yet" case collapses its
                // text into the tappable control itself (text + ›) — a day
                // stuck on an open contest keeps its own explanatory line
                // plus a separate "Resume" action, since "Still being
                // decided by the group" isn't itself an instruction to tap.
                nothingScheduled={!d.hasOpenContest}
                onResume={() =>
                  d.hasOpenContest && d.firstContestId
                    ? navigate(`/trips/${TRIP.id}/contests/${d.firstContestId}`)
                    : navigate(`/trips/${TRIP.id}/schedule/${d.dayIndex}`)
                }
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}

function DayCard({ label, stops, contributors }) {
  return (
    <div style={{ borderRadius: "var(--radius-2xl)", background: "var(--surface-card)", border: "1px solid var(--hairline)", boxShadow: "var(--shadow-card)", padding: "15px 16px" }}>
      <div className="serif-place" style={{ fontSize: 19, color: "var(--text-primary)" }}>{label}</div>
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
        {stops.map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 10 }}>
            <div className="mono-data-sm" style={{ width: 44, flex: "none", color: "var(--text-muted)", paddingTop: 2 }}>{s.time}</div>
            <div style={{ flex: 1, borderLeft: `2px solid ${s.notable ? "var(--stone-250)" : "var(--geo)"}`, paddingLeft: 10 }}>
              <div style={{ font: "600 13px var(--font-sans)", color: "var(--text-primary)" }}>{s.title}</div>
              <div style={{ font: "400 11px var(--font-sans)", color: "var(--text-secondary)", marginTop: 1 }}>{s.detail}{s.notable ? " · unconfirmed" : ""}</div>
            </div>
          </div>
        ))}
        {stops.length === 0 && <div style={{ font: "400 12px var(--font-sans)", color: "var(--text-muted)" }}>Nothing placed yet.</div>}
      </div>
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
        <AvatarStack contributors={contributors.slice(0, 3)} size={22} />
      </div>
    </div>
  );
}

function UnfinishedCard({ label, place, onResume, nothingScheduled = false }) {
  return (
    <div style={{ borderRadius: "var(--radius-2xl)", border: "1.5px dashed var(--border-strong)", padding: "15px 16px" }}>
      <div className="serif-place" style={{ fontSize: 19, color: "var(--text-primary)" }}>{label}</div>
      {nothingScheduled ? (
        // "Nothing scheduled yet" doubles as the tap target here, instead
        // of a separate caption plus its own "Resume" button below it —
        // there's nothing to resume, just an empty day to go start
        // scheduling.
        <button
          onClick={onResume}
          style={{ marginTop: 6, display: "inline-flex", alignItems: "center", gap: 5, font: "600 12px var(--font-sans)", color: "var(--accent)" }}
        >
          {place}
          <FontAwesomeIcon icon={faArrowRight} style={{ width: 10, height: 10 }} />
        </button>
      ) : (
        <>
          <div style={{ font: "400 12px var(--font-sans)", color: "var(--text-secondary)", marginTop: 4 }}>{place}</div>
          <button onClick={onResume} style={{ marginTop: 10, font: "600 12px var(--font-sans)", color: "var(--accent)" }}>Resume</button>
        </>
      )}
    </div>
  );
}
