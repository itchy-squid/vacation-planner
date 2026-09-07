import { useNavigate } from "react-router-dom";
import AvatarStack from "../components/planner/AvatarStack";
import { usePlannerState } from "../state/PlannerContext";
import { clock, fmtMin, sequenceStops, draftSetTotals } from "../data/derive";
import HomeButton from "../components/core/HomeButton";

const DRAFT_COLOR = "#6f7f3c";

// Screen 7 — "read the locked plan." Handoff README screen 7. Day 5 reads
// straight from shared state, so locking a set on the compare screen shows
// up here immediately; the surrounding days are static sample content for
// this mock-data pass.
const FINISHED_DAYS = [
  {
    day: 1,
    place: "Taipei",
    dateLabel: "FRI OCT 3",
    stops: [
      { time: "14:00", title: "Arrive · check in, Da'an", detail: "Hotel", notable: false },
      { time: "18:00", title: "Raohe Night Market", detail: "$15 · Jae's pick", notable: true },
    ],
  },
  {
    day: 2,
    place: "Taipei",
    dateLabel: "SAT OCT 4",
    stops: [
      { time: "15:50", title: "Elephant Mountain lookout", detail: "free · sunset", notable: true },
      { time: "19:00", title: "Din Tai Fung, Xinyi", detail: "$25 · reservation", notable: false },
    ],
  },
];

export default function FinalItinerary() {
  const navigate = useNavigate();
  const state = usePlannerState();
  const { trip: TRIP, day5Block, pins, draft, lockedSetKey, contributors } = state;

  const day5Locked = Boolean(lockedSetKey) && Boolean(day5Block);
  const lockedRealSet = day5Locked && lockedSetKey !== "C" ? day5Block.candidateSets.find((cs) => cs.key === lockedSetKey) : null;
  const blockMinutes = day5Block ? day5Block.end - day5Block.start : 0;
  const day5Totals = day5Locked
    ? lockedRealSet
      ? { cost: Math.round(lockedRealSet.totalCostCents / 100), slack: lockedRealSet.slackMinutes }
      : draftSetTotals(pins, draft, blockMinutes)
    : null;
  const day5StopPins = day5Locked
    ? lockedRealSet
      ? lockedRealSet.stopPinIds.map((id) => pins[id]).filter(Boolean)
      : draft.map((id) => pins[id]).filter(Boolean)
    : [];
  const day5Stops = day5Block ? sequenceStops(day5StopPins, day5Block.start, 10) : [];
  const day5Color = lockedRealSet?.color ?? DRAFT_COLOR;

  const finishedCount = FINISHED_DAYS.length + (day5Locked ? 1 : 0);

  return (
    <div className="screen">
      <div className="screen-scroll" style={{ paddingBottom: 32 }}>
        <div style={{ padding: "20px var(--gutter-text) 0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="mono-caption">Locked Oct 2 · {finishedCount} of 8 days set</div>
            <HomeButton />
          </div>
          <div className="serif-place" style={{ fontSize: 30, marginTop: 4, color: "var(--text-primary)" }}>{TRIP.name}</div>
          <div style={{ font: "400 13px var(--font-sans)", color: "var(--text-secondary)", marginTop: 2 }}>{TRIP.regionLine}</div>
          <div style={{ marginTop: 12, height: 6, borderRadius: 999, background: "var(--surface-sunken)", overflow: "hidden" }}>
            <div style={{ width: `${(finishedCount / 8) * 100}%`, height: "100%", background: "var(--geo)" }} />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "18px var(--gutter-screen) 0" }}>
          {FINISHED_DAYS.map((d) => (
            <DayCard key={d.day} day={d.day} place={d.place} dateLabel={d.dateLabel} stops={d.stops} contributors={contributors} />
          ))}

          {day5Locked ? (
            <DayCard
              day={5}
              place="Xiaoliuqiu"
              dateLabel="TUE OCT 7"
              contributors={contributors}
              stops={day5Stops.map((x, i) => ({
                time: clock(x.start),
                title: x.pin.title,
                detail: `${fmtMin(x.pin.dur)} · $${x.pin.cost}`,
                notable: i === 0,
              }))}
              accentColor={day5Color}
              footerNote={`Set ${lockedSetKey} · ${day5Totals.cost === 0 ? "free" : `$${day5Totals.cost} each`} · ${fmtMin(day5Totals.slack)} slack`}
            />
          ) : (
            <UnfinishedCard label="Day 5" place="Xiaoliuqiu · block still contested" onResume={() => navigate(`/trips/${TRIP.id}/schedule/5`)} />
          )}

          <UnfinishedCard label="Days 6–8" place="Hualien · Tainan · 3 blocks still open" onResume={() => navigate(`/trips/${TRIP.id}/schedule/6`)} />
        </div>
      </div>
    </div>
  );
}

function DayCard({ day, place, dateLabel, stops, accentColor, footerNote, contributors }) {
  return (
    <div style={{ borderRadius: "var(--radius-2xl)", background: "var(--surface-card)", border: "1px solid var(--hairline)", boxShadow: "var(--shadow-card)", padding: "15px 16px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div className="serif-place" style={{ fontSize: 19, color: "var(--text-primary)" }}>Day {day} · {place}</div>
        <div className="mono-data-sm" style={{ color: "var(--text-muted)" }}>{dateLabel}</div>
      </div>
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
        {stops.map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 10 }}>
            <div className="mono-data-sm" style={{ width: 44, flex: "none", color: "var(--text-muted)", paddingTop: 2 }}>{s.time}</div>
            <div style={{ flex: 1, borderLeft: `2px solid ${s.notable ? accentColor ?? "var(--accent)" : "var(--stone-200)"}`, paddingLeft: 10 }}>
              <div style={{ font: "600 13px var(--font-sans)", color: "var(--text-primary)" }}>{s.title}</div>
              <div style={{ font: "400 11px var(--font-sans)", color: "var(--text-secondary)", marginTop: 1 }}>{s.detail}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <AvatarStack contributors={contributors.slice(0, 3)} size={22} />
        <span style={{ font: "400 11px var(--font-sans)", color: "var(--accent)" }}>{footerNote ?? "2 comments"}</span>
      </div>
    </div>
  );
}

function UnfinishedCard({ label, place, onResume }) {
  return (
    <div style={{ borderRadius: "var(--radius-2xl)", border: "1.5px dashed var(--border-strong)", padding: "15px 16px" }}>
      <div className="serif-place" style={{ fontSize: 19, color: "var(--text-primary)" }}>{label}</div>
      <div style={{ font: "400 12px var(--font-sans)", color: "var(--text-secondary)", marginTop: 4 }}>{place}</div>
      <button onClick={onResume} style={{ marginTop: 10, font: "600 12px var(--font-sans)", color: "var(--accent)" }}>Resume</button>
    </div>
  );
}
