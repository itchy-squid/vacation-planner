import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import TimeBlock from "../components/planner/TimeBlock";
import PhotoPlaceholder from "../components/core/PhotoPlaceholder";
import { usePlannerState } from "../state/PlannerContext";
import { TRIP_DAYS } from "../data/trip";
import { blocksForDay, dayHeaderLabel, UNPLACED_TRAY_TITLES } from "../data/schedule";
import { fmtMin } from "../data/derive";
import HomeButton from "../components/core/HomeButton";
import SettingsButton from "../components/core/SettingsButton";

const REGION_BY_DAY = { 1: "Taipei", 2: "Taipei", 3: "Taipei", 4: "Taipei", 5: "Xiaoliuqiu", 6: "Xiaoliuqiu", 7: "Hualien", 8: "Hualien" };

// Screen 4 — "place pins into free-length blocks; surface conflicts."
// Handoff README screen 4. Day 5's 13:00-16:00 block is the one modeled
// contested block that opens the compare screen; other days show
// representative (non-authoritative) blocks — see data/schedule.js.
export default function DaySchedule() {
  const navigate = useNavigate();
  const { day } = useParams();
  const dayIndex = Number(day) || 5;
  const state = usePlannerState();

  const blocks = blocksForDay(dayIndex);
  const { day5Block, pins, draft, lockedSetKey } = state;

  const contestedBlockView = useMemo(() => {
    if (!day5Block || day5Block.dayIndex !== dayIndex) return null;
    const realSets = day5Block.candidateSets;
    const setCount = realSets.length + (draft.length ? 1 : 0);
    const lockedTotals = lockedSetKey && lockedSetKey !== "C" ? realSets.find((s) => s.key === lockedSetKey) : null;

    const setChips = realSets.map((s) => ({
      key: s.key,
      color: s.color,
      label: `Set ${s.key} · ${s.stopPinIds.length} stop${s.stopPinIds.length === 1 ? "" : "s"} · ${fmtMin(s.slackMinutes)} slack`,
    }));
    if (draft.length) {
      setChips.push({ key: "C", color: "#6f7f3c", label: `Set C · ${draft.length} stop${draft.length === 1 ? "" : "s"} · your draft` });
    }

    const conflictNames = realSets
      .flatMap((s) => s.stopPinIds)
      .map((id) => pins[id]?.short)
      .filter(Boolean)
      .join(" · ");

    return {
      id: day5Block.id,
      type: lockedSetKey ? "locked" : "contested",
      start: day5Block.start,
      end: day5Block.end,
      headline: `${setCount} candidate set${setCount === 1 ? "" : "s"} want this block`,
      conflictNames,
      setChips,
      votedCount: day5Block.votedCount,
      totalVoters: day5Block.contributorCount,
      title: lockedSetKey ? `Set ${lockedSetKey} locked` : undefined,
      meta: lockedSetKey
        ? `${clock(day5Block.start)}–${clock(day5Block.end)} · ${
            lockedTotals ? `$${Math.round(lockedTotals.totalCostCents / 100)} each · ${fmtMin(lockedTotals.slackMinutes)} slack` : "your draft"
          }`
        : undefined,
    };
  }, [day5Block, dayIndex, draft, lockedSetKey, pins]);

  const region = REGION_BY_DAY[dayIndex] ?? "Trip";

  return (
    <div className="screen">
      <div className="screen-scroll" style={{ paddingBottom: 24 }}>
        <div style={{ padding: "20px var(--gutter-text) 12px", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
            <HomeButton />
            <SettingsButton />
            <div>
              <div className="mono-caption">Scheduling · {region}</div>
              <div className="serif-place" style={{ fontSize: 24, marginTop: 2, color: "var(--text-primary)" }}>{dayHeaderLabel(dayIndex)}</div>
            </div>
          </div>
          <div style={{ padding: "7px 12px", borderRadius: 999, background: "var(--surface-card)", border: "1px solid var(--border)", font: "600 12px var(--font-sans)", color: "var(--text-primary)" }}>
            {region}
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, padding: "0 var(--gutter-screen) 16px", overflowX: "auto" }}>
          {TRIP_DAYS.map((d, i) => {
            const n = i + 1;
            const selected = n === dayIndex;
            return (
              <button
                key={d.n}
                onClick={() => navigate(`/schedule/${n}`)}
                style={{
                  flex: "none",
                  width: 38,
                  padding: "6px 0",
                  borderRadius: "var(--radius-md)",
                  background: selected ? "var(--surface-inverse)" : "var(--surface-card)",
                  border: selected ? "none" : "1px solid var(--border)",
                  textAlign: "center",
                }}
              >
                <div className="mono-data-sm" style={{ color: selected ? "rgba(255,255,255,.6)" : "var(--text-faint)", letterSpacing: 0 }}>{d.dow}</div>
                <div style={{ font: "600 14px var(--font-sans)", marginTop: 1, color: selected ? "#fff" : "var(--text-primary)" }}>{d.n}</div>
              </button>
            );
          })}
        </div>

        <div style={{ background: "var(--surface-card)", borderTop: "1px solid var(--hairline)", padding: "18px 16px 24px", minHeight: 420 }}>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ width: 44, flex: "none", display: "flex", flexDirection: "column", gap: 6 }}>
              {blocks.map((b) => (
                <div key={b.id} className="mono-data-sm" style={{ color: "var(--text-faint)", height: blockHeight(b) }}>
                  {clock(b.start)}
                </div>
              ))}
              {contestedBlockView ? <div className="mono-data-sm" style={{ color: "var(--text-faint)" }}>{clock(contestedBlockView.start)}</div> : null}
            </div>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {blocks.map((b) => (
                <div key={b.id} style={{ minHeight: blockHeight(b) }}>
                  <TimeBlock block={b} />
                </div>
              ))}
              {contestedBlockView ? <TimeBlock block={contestedBlockView} onOpen={() => navigate("/compare")} /> : null}
            </div>
          </div>
        </div>
      </div>

      <div style={{ background: "var(--surface-inverse)", padding: "12px 16px 40px", flex: "none" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <span className="mono-caption" style={{ color: "rgba(255,255,255,.5)" }}>Tray · {UNPLACED_TRAY_TITLES.length} unplaced</span>
          <button style={{ font: "500 11px var(--font-sans)", color: "rgba(255,255,255,.7)" }}>filter</button>
        </div>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", marginTop: 10 }}>
          {UNPLACED_TRAY_TITLES.map((title) => {
            const pin = Object.values(pins).find((p) => p.title === title);
            if (!pin) return null;
            return (
              <div key={pin.id} style={{ width: 96, flex: "none" }}>
                <PhotoPlaceholder height={54} radius={11} dark label="" style={{ background: "var(--ink-700)" }} />
                <div style={{ font: "600 10.5px var(--font-sans)", color: "var(--text-on-dark)", marginTop: 5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pin.title}</div>
                <div className="mono-data-sm" style={{ color: "var(--text-on-dark-muted)", marginTop: 1 }}>{pin.dur}m</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function blockHeight(b) {
  if (b.type === "empty") return 52;
  if (!b.end) return 60;
  return Math.max(48, Math.round(((b.end - b.start) / 75) * 48));
}

function clock(m) {
  if (m == null) return "";
  const t = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
