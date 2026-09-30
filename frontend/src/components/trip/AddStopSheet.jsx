import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faClock, faList, faLocationDot } from "@fortawesome/free-solid-svg-icons";
import BottomSheet from "../core/BottomSheet";
import Button from "../core/Button";
import Stepper from "../forms/Stepper";
import CostField from "../forms/CostField";
import { formatDuration } from "../../lib/format";

const MIN_LENGTH = 15;

/**
 * "+ Add a stop": tap a place on the map (the quick way, for anything with
 * a spot), pick from the ideas list (which also has the ideas with no
 * spot, and custom events nobody has scheduled), or make a custom event.
 * Anything with no spot happens where the group already is, so it adds no
 * ride.
 *
 *   after        the stop it goes after, for the heading
 *   ideas        [{ ref, title, located, dur }]
 *   onMap()      start tapping the map
 *   onIdea(ref)
 *   onCustom({ title, dur, costCents, costBasis }) -> Promise<string | null>, an error
 */
export default function AddStopSheet({ after, ideas, canSetCost, onMap, onIdea, onCustom, onClose }) {
  const [view, setView] = useState("menu");
  const [draft, setDraft] = useState({ title: "", dur: 60, cost: 0, costBasis: "per_head" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create(e) {
    e.preventDefault();
    if (!draft.title.trim() || busy) return;
    setBusy(true);
    setError("");
    const problem = await onCustom({
      title: draft.title.trim(),
      dur: Math.max(MIN_LENGTH, draft.dur),
      costCents: canSetCost ? Math.max(0, Math.round((Number(draft.cost) || 0) * 100)) : 0,
      costBasis: draft.costBasis,
    });
    setBusy(false);
    if (problem) setError(problem);
  }

  const heading = after ? `Add a stop after ${after}` : "Add a stop";

  return (
    <BottomSheet label={heading} onClose={onClose}>
      <div className="screen-scroll" style={{ padding: "8px 18px 22px", display: "flex", flexDirection: "column", gap: 10 }}>
        {view === "menu" ? (
          <>
            <span className="mono-caption">{heading}</span>
            <Row icon={faLocationDot} tint="var(--geo-quiet)" ink="var(--geo)" title="Tap a place on the map" sub="Ideas with a spot" onClick={onMap} />
            <Row
              icon={faList}
              tint="var(--surface-sunken)"
              ink="var(--text-secondary)"
              title="From the ideas list"
              sub={ideas.length ? `${ideas.length} not planned yet${noSpot(ideas)}` : "Nothing left to add"}
              disabled={!ideas.length}
              onClick={() => setView("ideas")}
            />
            <Row icon={faClock} tint="var(--surface-sunken)" ink="var(--text-secondary)" title="Custom event" sub="Lunch, a rest, anything that isn’t an idea" onClick={() => setView("custom")} last />
          </>
        ) : null}

        {view === "ideas" ? (
          <>
            <Back onClick={() => setView("menu")}>From the ideas list</Back>
            <ul style={{ listStyle: "none", display: "flex", flexDirection: "column" }}>
              {ideas.map((idea) => (
                <li key={idea.ref}>
                  <button
                    type="button"
                    onClick={() => onIdea(idea.ref)}
                    style={{ width: "100%", minHeight: 48, display: "flex", alignItems: "center", gap: 10, textAlign: "left", borderBottom: "1px solid var(--hairline)", padding: "6px 0" }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", font: "600 13.5px var(--font-sans)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{idea.title}</span>
                      <span className="mono-data-sm" style={{ color: "var(--text-muted)", letterSpacing: 0 }}>
                        {formatDuration(idea.dur ?? 60)}
                        {idea.located ? "" : " · no map spot, no ride"}
                      </span>
                    </span>
                    <span style={{ color: "var(--accent)", font: "600 18px var(--font-sans)" }}>+</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {view === "custom" ? (
          <form onSubmit={create} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Back onClick={() => setView("menu")}>Custom event</Back>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="mono-caption">What</span>
              <input
                autoFocus
                value={draft.title}
                maxLength={200}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="Lunch"
                style={{ height: 44, borderRadius: "var(--radius-lg)", border: "1px solid var(--border-strong)", background: "var(--surface-page)", padding: "0 12px", font: "500 14px var(--font-sans)", color: "var(--text-primary)" }}
              />
            </label>
            <Stepper
              label="How long"
              valueLabel={formatDuration(draft.dur)}
              downDisabled={draft.dur <= MIN_LENGTH}
              onDown={() => setDraft((d) => ({ ...d, dur: Math.max(MIN_LENGTH, d.dur - 15) }))}
              onUp={() => setDraft((d) => ({ ...d, dur: d.dur + 15 }))}
            />
            {canSetCost ? (
              <CostField
                id="custom-cost"
                value={draft.cost}
                onChange={(cost) => setDraft((d) => ({ ...d, cost }))}
                basis={draft.costBasis}
                onBasis={(costBasis) => setDraft((d) => ({ ...d, costBasis }))}
              />
            ) : null}
            <span style={{ font: "400 12px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>
              It happens where the group already is{after ? `, at ${after}` : ""}, so there’s no ride to it.
            </span>
            {error ? (
              <span role="alert" style={{ font: "500 12.5px var(--font-sans)", color: "var(--warn)" }}>
                {error}
              </span>
            ) : null}
            <Button type="submit" disabled={!draft.title.trim() || busy}>
              {busy ? "Adding…" : after ? `Add after ${after}` : "Add it"}
            </Button>
          </form>
        ) : null}
      </div>
    </BottomSheet>
  );
}

function noSpot(ideas) {
  const n = ideas.filter((i) => !i.located).length;
  return n ? `, ${n} with no map spot` : "";
}

function Row({ icon, tint, ink, title, sub, onClick, disabled = false, last = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 56, textAlign: "left", borderBottom: last ? "none" : "1px solid var(--hairline)", opacity: disabled ? 0.45 : 1 }}
    >
      <span style={{ width: 38, height: 38, flex: "none", borderRadius: "var(--radius-md)", background: tint, color: ink, display: "grid", placeItems: "center" }}>
        <FontAwesomeIcon icon={icon} style={{ width: 17, height: 17 }} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", font: "600 13.5px var(--font-sans)", color: "var(--text-primary)" }}>{title}</span>
        <span style={{ display: "block", font: "400 11.5px var(--font-sans)", color: "var(--text-secondary)" }}>{sub}</span>
      </span>
      <span style={{ color: "var(--text-faint)", fontSize: 16 }}>›</span>
    </button>
  );
}

function Back({ onClick, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <button type="button" aria-label="Back" onClick={onClick} style={{ width: 32, height: 32, color: "var(--accent)", font: "500 18px var(--font-sans)" }}>
        ‹
      </button>
      <span className="serif-place" style={{ fontSize: 19 }}>
        {children}
      </span>
    </div>
  );
}
