import { useEffect, useRef, useState } from "react";
import PhotoPlaceholder from "../core/PhotoPlaceholder";
import MetricTile from "./MetricTile";

// Picking a set puts its stops on the calendar and deletes every other set
// in the decision, with no way back — so the button takes two taps, the
// same "confirm?" treatment as "Delete permanently" in
// PlanDetailsSheet.jsx. The window is longer than that one's because
// there's a sentence to read in it.
const PICK_CONFIRM_WINDOW_MS = 5000;

// Only the selected card expands. Selection border/shadow only — never a
// background change. See handoff README screen 5 "Set cards".
//
// Two tiles, not three: the "moving" tile is gone along with the flat
// per-hop travel estimate behind it (see backend/app/derive.py's module
// docstring — three screens each guessed a different number, so all three
// now show none). And the remaining cost tile reads "total", not "each":
// a plan's cost is the whole cost of its stops, and the Expenses screen
// shows the same figure as a trip total, so calling it "each" here would
// make two screens disagree about one number.
export default function SetCard({
  color,
  name,
  setLetter,
  sub,
  isLeading,
  isMajority,
  votes,
  cost,
  slack,
  slackColor,
  rationale,
  selected,
  onSelect,
  stops,
  canEdit,
  onEdit,
  voted,
  // null when the viewer can't vote (a reader) — the button isn't shown.
  onVote,
  onPick,
  isOwner,
  ownerName,
  otherSetCount = 0,
}) {
  const [pickArmed, setPickArmed] = useState(false);
  const disarmRef = useRef(null);
  useEffect(() => () => clearTimeout(disarmRef.current), []);
  // Collapsing the card (selecting another) stands the confirm down, so a
  // stale "confirm?" never waits on a card nobody is looking at.
  useEffect(() => {
    if (!selected) {
      clearTimeout(disarmRef.current);
      setPickArmed(false);
    }
  }, [selected]);

  function handlePickTap(e) {
    e.stopPropagation();
    if (!pickArmed) {
      setPickArmed(true);
      clearTimeout(disarmRef.current);
      disarmRef.current = setTimeout(() => setPickArmed(false), PICK_CONFIRM_WINDOW_MS);
      return;
    }
    clearTimeout(disarmRef.current);
    setPickArmed(false);
    onPick();
  }

  return (
    <div
      style={{
        borderRadius: "var(--radius-2xl)",
        border: selected ? `1.5px solid ${color}` : "1px solid var(--border)",
        boxShadow: selected ? "var(--shadow-select)" : "none",
        background: "var(--surface-card)",
        transition: "var(--transition-select)",
      }}
    >
      <div className="tap" onClick={onSelect} style={{ padding: "11px 12px 10px", cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 10, height: 10, borderRadius: 3, background: color, flex: "none" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              {setLetter ? (
                <span className="mono-data-sm" style={{ color: "var(--text-faint)", flex: "none" }}>
                  SET {setLetter}
                </span>
              ) : null}
              <div style={{ font: "600 13.5px var(--font-sans)", color: "var(--text-primary)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {name}
              </div>
            </div>
            <div className="mono-data-sm" style={{ color: "var(--text-secondary)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {sub}
            </div>
          </div>
          {/* MAJORITY outranks LEADING and replaces it — "most votes so
              far" and "more than half the group" are the same card's
              story at two different strengths, and showing both would
              read as two separate accolades. */}
          {isMajority ? (
            <span style={{ font: "600 9px var(--font-mono)", background: "var(--accent)", color: "#fff", padding: "3px 6px", borderRadius: 4, flex: "none" }}>
              MAJORITY
            </span>
          ) : isLeading ? (
            <span style={{ font: "600 9px var(--font-mono)", background: "var(--surface-sunken)", color: "var(--text-secondary)", padding: "3px 6px", borderRadius: 4, flex: "none" }}>
              LEADING
            </span>
          ) : null}
          <div style={{ textAlign: "center", flex: "none", minWidth: 34 }}>
            <div style={{ font: "600 15px var(--font-sans)", color: "var(--stone-700)" }}>{votes}</div>
            <div style={{ font: "500 8px var(--font-mono)", color: "var(--text-muted)" }}>VOTES</div>
          </div>
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
          {/* No cost for a viewer who can't see costs (a reader). */}
          {cost == null ? null : <MetricTile value={`$${cost}`} label="total" />}
          <MetricTile value={fmtMin(slack)} label="slack" valueColor={slackColor} />
        </div>
      </div>

      {selected ? (
        <div style={{ padding: "0 12px 12px" }}>
          {/* One action for the whole set, not one per stop. A set is an
              arrangement — which places, in which order, at which times —
              and every part of it is edited on the screen it was built on.
              Only offered to someone who can actually change it: the
              option already on the board has no author, and nor is
              somebody else's proposal yours unless you own the trip. */}
          {canEdit ? (
            <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 10, display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
              <span className="mono-data-sm" style={{ color: "var(--text-muted)" }}>
                THE DAY
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                style={{ font: "600 11px var(--font-sans)", color: "var(--accent)", flex: "none" }}
              >
                Edit this set
              </button>
            </div>
          ) : null}
          <div style={{ borderTop: canEdit ? "none" : "1px solid var(--hairline)", paddingTop: canEdit ? 6 : 10, display: "flex", flexDirection: "column", gap: 7 }}>
            {/* Read-only rows. These used to carry an "Edit" that opened
                the pin's own screen, which took someone comparing two
                sets out of the comparison entirely — and then edited the
                pin itself, changing it in every set at once rather than
                in the one they were looking at. Changing this set is the
                action above. */}
            {stops.map((s) => (
              <div
                key={s.id}
                style={{ display: "flex", gap: 9, alignItems: "center", background: "var(--surface-inset)", border: "1px solid rgba(27,26,31,.07)", borderRadius: "var(--radius-md)", padding: "8px 9px" }}
              >
                <PhotoPlaceholder height={34} radius={8} label="" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: "600 11.5px var(--font-sans)", lineHeight: 1.25, color: "var(--text-primary)" }}>{s.title}</div>
                  <div className="mono-data-sm" style={{ color: "var(--text-muted)", marginTop: 2 }}>{s.meta}</div>
                </div>
              </div>
            ))}
            {stops.length === 0 ? (
              <div style={{ font: "400 11px var(--font-sans)", color: "var(--text-muted)" }}>Add pins from the pool below.</div>
            ) : null}
          </div>

          {/* The proposer's own case for this set, in their words. Only
              a set proposed through the block flow has one. */}
          {rationale ? (
            <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: "var(--radius-md)", background: "var(--plum-tint)", font: "400 12px/1.5 var(--font-sans)", color: "var(--accent-press)" }}>
              {rationale}
            </div>
          ) : null}

          {onVote || isOwner ? (
            <div style={{ marginTop: 11, display: "flex", gap: 8 }}>
              {onVote ? (
                <button
                  type="button"
                  onClick={onVote}
                  style={{
                    flex: 1,
                    height: 40,
                    borderRadius: "var(--radius-lg)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    font: "600 13px var(--font-sans)",
                    background: voted ? color : "var(--surface-card)",
                    color: voted ? "#fff" : "var(--text-primary)",
                    border: voted ? "none" : "1px solid var(--border-strong)",
                    transition: "background var(--dur-fast) var(--ease-standard)",
                  }}
                >
                  {voted ? "Voted ✓" : "Vote for this set"}
                </button>
              ) : null}
              {isOwner ? (
                <button
                  type="button"
                  onClick={handlePickTap}
                  style={{
                    flex: 1,
                    height: 40,
                    borderRadius: "var(--radius-lg)",
                    background: pickArmed ? "var(--danger, #b3261e)" : "var(--surface-inverse)",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    font: "600 13px var(--font-sans)",
                    transition: "background var(--dur-base, .15s) var(--ease-standard, ease)",
                  }}
                >
                  {/* A majority doesn't resolve anything by itself — the
                      owner still decides, and the label says which of the
                      two things they're doing. */}
                  {pickArmed ? "confirm?" : isMajority ? "Go with the majority" : "Pick this set"}
                </button>
              ) : null}
            </div>
          ) : null}
          {isOwner && pickArmed ? (
            <div
              role="alert"
              style={{
                marginTop: 8,
                padding: "8px 11px",
                borderRadius: "var(--radius-md)",
                background: "var(--warn-tint, #fdf1e6)",
                font: "500 11.5px/1.45 var(--font-sans)",
                color: "var(--warn, #a15c1a)",
              }}
            >
              {otherSetCount > 0
                ? `Tap again to put this set's stops on the calendar. The other ${otherSetCount === 1 ? "set" : `${otherSetCount} sets`} for these hours will be forgotten, along with any custom events only ${otherSetCount === 1 ? "it uses" : "they use"}. This can't be undone.`
                : "Tap again to put this set's stops on the calendar."}
            </div>
          ) : null}
          {!isOwner ? (
            <div style={{ marginTop: 8, font: "400 10.5px var(--font-sans)", color: "var(--text-muted)" }}>
              {ownerName ? `Only ${ownerName} (owner) can pick a set.` : "Only the trip owner can pick a set."}{" "}
              {onVote ? "Everyone else can vote and comment." : "As a reader you can follow the vote but not take part."}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function fmtMin(m) {
  const s = m < 0 ? "−" : "";
  const a = Math.abs(m);
  const h = Math.floor(a / 60);
  const mm = a % 60;
  return h ? `${s}${h}h${mm ? ` ${mm}m` : ""}` : `${s}${mm}m`;
}
