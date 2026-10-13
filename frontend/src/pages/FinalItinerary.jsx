import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRight } from "@fortawesome/free-solid-svg-icons";
import AvatarStack from "../components/planner/AvatarStack";
import { usePlannerState, useMyTraveler, useCan } from "../state/PlannerContext";
import { membersOf, namesOf, planIncludes } from "../lib/splits";
import TripHeader from "../components/core/TripHeader";
import { fmtMin } from "../data/derive";
import { getTripDays, tripDayLabel } from "../data/trip";
import { clockLabel } from "../lib/planTime";
import PinMark from "../components/core/PinMark";
import { hasSpot } from "../lib/pinSpot";
import DayCommentsPreview from "../components/comments/DayCommentsPreview";
import DayCommentsSheet from "../components/comments/DayCommentsSheet";
import { useDayComments } from "../components/comments/useDayComments";

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
  const { trip: TRIP, plans, travelers, pins } = state;
  // Each day's comments, under its stops; tapping them opens the day's
  // comments, the same sheet as the Plan tab's comment chip.
  const can = useCan();
  const canComment = can("comments:write");
  const dayComments = useDayComments(TRIP?.id);
  const [commentsDay, setCommentsDay] = useState(null);
  // The traveler you are; null when you're planning but not going, in
  // which case there's no "my itinerary" to show.
  const me = useMyTraveler();
  const myId = me?.id ?? null;

  // Once the group splits up for part of a day (lib/splits.js), "the
  // itinerary" stops being one list. Yours is the default: the stops
  // you're on, who with, and a line for where everyone else is — which is
  // what answers "when do we meet up?". The whole group's view keeps every
  // stop and says whose each one is.
  const hasSplits = state.splits.length > 0;
  const [mine, setMine] = useState(true);
  const showMine = mine && hasSplits && myId != null;

  const tripDays = useMemo(() => getTripDays(TRIP), [TRIP]);

  const dayViews = useMemo(() => {
    return tripDays.map((_, i) => {
      const dayIndex = i + 1;
      const dayPlans = plans
        .filter((p) => p.startDt && p.startDt?.dayIndex === dayIndex)
        .sort((a, b) => a.startDt.minuteOfDay - b.startDt.minuteOfDay);
      const hasOpenContest = dayPlans.some((p) => p.status === "contested");
      const settledPlans = dayPlans.filter((p) => p.status === "placed" || p.status === "pencilled" || p.status === "locked");

      const stops = [];
      const shownPlans = showMine ? settledPlans.filter((p) => planIncludes(p, myId)) : settledPlans;
      shownPlans.forEach((p) => {
        const people = p.forEveryone ? [] : membersOf(p, travelers);
        const withLabel = !people.length
          ? ""
          : showMine
          ? people.length > 1
            ? `with ${namesOf(people.filter((c) => c.id !== myId))}`
            : "just you"
          : namesOf(people);
        p.items.forEach((item) => {
          const pin = item.pinId != null ? pins[item.pinId] : null;
          stops.push({
            // Whether the stop is an idea with an exact spot on the map
            // (components/core/PinMark.jsx); null for a ride or an event.
            spotted: pin ? hasSpot(pin) : null,
            withLabel,
            time: clockLabel(item.startMinuteOfDay ?? p.startDt.minuteOfDay),
            sortKey: item.startMinuteOfDay ?? p.startDt.minuteOfDay,
            title: item.title,
            detail: item.costCents
              ? `${fmtMin(item.durationMinutes)} · $${Math.round(item.costCents / 100)}${item.costPer === "day" ? "/day" : ""}`
              : fmtMin(item.durationMinutes),
            notable: p.status === "pencilled",
          });
        });
      });
      // A captured incumbent carries explicit offsets, so its stops are
      // not necessarily in plan order — sort by the clock, which is the
      // order a day is actually read in.
      stops.sort((a, b) => a.sortKey - b.sortKey);

      // Where everyone else is while you're off with your group: one line
      // per other group, not their stop list.
      const elsewhere = [];
      if (showMine) {
        const byGroup = new Map();
        settledPlans
          .filter((p) => !planIncludes(p, myId))
          .forEach((p) => {
            const key = p.branchId;
            if (!byGroup.has(key)) byGroup.set(key, { people: membersOf(p, travelers), titles: [], endMin: 0 });
            const g = byGroup.get(key);
            p.items.forEach((item) => g.titles.push(item.title));
            if (!p.items.length && p.label) g.titles.push(p.label);
            g.endMin = Math.max(g.endMin, p.endDt?.minuteOfDay ?? 0);
          });
        byGroup.forEach((g, key) =>
          elsewhere.push({
            key,
            text: `${namesOf(g.people)}: ${g.titles.join(", ") || "their own plans"} until ${clockLabel(g.endMin)}`,
          })
        );
      }

      return {
        elsewhere,
        dayIndex,
        label: tripDayLabel(dayIndex, TRIP),
        stops,
        settled: !hasOpenContest && settledPlans.length > 0,
        hasOpenContest,
        firstContestId: dayPlans.find((p) => p.status === "contested")?.contestId ?? null,
      };
    });
  }, [tripDays, plans, TRIP, showMine, myId, travelers, pins]);

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
          {hasSplits && myId != null && (
            <div role="group" aria-label="Whose itinerary" style={{ marginTop: 14, display: "flex", background: "var(--surface-sunken)", borderRadius: "var(--radius-md)", padding: 2 }}>
              {[
                { value: true, label: "My itinerary" },
                { value: false, label: "Whole group" },
              ].map((opt) => (
                <button
                  key={String(opt.value)}
                  type="button"
                  aria-pressed={mine === opt.value}
                  onClick={() => setMine(opt.value)}
                  style={{
                    flex: 1,
                    padding: "6px 0",
                    borderRadius: "calc(var(--radius-md) - 2px)",
                    background: mine === opt.value ? "var(--surface-card)" : "transparent",
                    boxShadow: mine === opt.value ? "var(--shadow-raised)" : "none",
                    font: "600 11.5px var(--font-sans)",
                    color: mine === opt.value ? "var(--text-primary)" : "var(--text-secondary)",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "18px var(--gutter-screen) 0" }}>
          {dayViews.map((d) => {
            const comments = (
              <DayCommentsPreview
                comments={dayComments.byDay[d.dayIndex] ?? []}
                contributors={state.contributors}
                currentUserId={state.currentUserId}
                canComment={canComment}
                onOpen={() => setCommentsDay(d.dayIndex)}
              />
            );
            return d.settled ? (
              <DayCard key={d.dayIndex} label={d.label} stops={d.stops} elsewhere={d.elsewhere} contributors={travelers} comments={comments} />
            ) : (
              <UnfinishedCard
                key={d.dayIndex}
                comments={comments}
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
            );
          })}
        </div>
      </div>

      {commentsDay != null && (
        <DayCommentsSheet
          day={commentsDay}
          label={tripDayLabel(commentsDay, TRIP)}
          comments={dayComments.byDay[commentsDay] ?? []}
          contributors={state.contributors}
          currentUserId={state.currentUserId}
          canComment={canComment}
          onAdd={dayComments.add}
          onEdit={dayComments.edit}
          onDelete={dayComments.remove}
          onClose={() => setCommentsDay(null)}
        />
      )}
    </div>
  );
}

function DayCard({ label, stops, elsewhere = [], contributors, comments = null }) {
  return (
    <div style={{ borderRadius: "var(--radius-2xl)", background: "var(--surface-card)", border: "1px solid var(--hairline)", boxShadow: "var(--shadow-card)", padding: "15px 16px" }}>
      <div className="serif-place" style={{ fontSize: 19, color: "var(--text-primary)" }}>{label}</div>
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
        {stops.map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 10 }}>
            <div className="mono-data-sm" style={{ width: 44, flex: "none", color: "var(--text-muted)", paddingTop: 2 }}>{s.time}</div>
            <div style={{ flex: 1, borderLeft: `2px solid ${s.notable ? "var(--stone-250)" : "var(--geo)"}`, paddingLeft: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, font: "600 13px var(--font-sans)", color: "var(--text-primary)" }}>
                {s.spotted != null ? <PinMark spotted={s.spotted} size={9} title={s.spotted ? "On the map" : "No map spot"} /> : null}
                {s.title}
              </div>
              <div style={{ font: "400 11px var(--font-sans)", color: "var(--text-secondary)", marginTop: 1 }}>{s.detail}{s.notable ? " · unconfirmed" : ""}</div>
              {s.withLabel && (
                <div style={{ font: "500 11px var(--font-sans)", color: "var(--text-secondary)", marginTop: 1 }}>{s.withLabel}</div>
              )}
            </div>
          </div>
        ))}
        {elsewhere.map((e) => (
          <div key={e.key} className="mono-data-sm" style={{ color: "var(--text-muted)", paddingLeft: 54, letterSpacing: "0.03em" }}>
            {e.text}
          </div>
        ))}
        {stops.length === 0 && <div style={{ font: "400 12px var(--font-sans)", color: "var(--text-muted)" }}>Nothing placed yet.</div>}
      </div>
      {comments}
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
        <AvatarStack contributors={contributors.slice(0, 3)} size={22} />
      </div>
    </div>
  );
}

function UnfinishedCard({ label, place, onResume, nothingScheduled = false, comments = null }) {
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
      {comments}
    </div>
  );
}
