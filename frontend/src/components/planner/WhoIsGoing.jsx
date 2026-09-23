import { useEffect, useMemo, useState } from "react";
import AvatarStack from "./AvatarStack";
import { usePlannerDispatch, usePlannerState, useCan, useCurrentUser } from "../../state/PlannerContext";
import { namesOf, partiesMeet, partyMembers, planIncludes } from "../../lib/party";
import { clockLabel } from "../../lib/planTime";

// "Who's going" on a calendar item's details sheet — where the group
// splits up, comes back together, and where anyone going can move
// themselves between the groups. See backend/app/party.py for the model:
// a plan's `party` is who it's for, [] is everyone, and two plans can
// share hours only when nobody is on both.
//
// Three things live here:
// - Splitting (plans:write): pick who goes off to do something else over
//   these hours. They get a new, empty plan of their own; everyone else
//   stays on this one. One call, so nobody is ever on both or neither.
// - Changing who's on a branch (plans:write): tap a face to take them off
//   or put them on. Putting on someone who's in the other group is
//   refused by name — take them off that one first.
// - Joining (plans:join, which companions have): "I'm going with Ana."
//   Moves only you, off whatever you were on at the same time.
export default function WhoIsGoing({ plan, editable, startMin, endMin }) {
  const { plans, contributors } = usePlannerState();
  const dispatch = usePlannerDispatch();
  const can = useCan();
  const me = useCurrentUser();
  const canJoin = can("plans:join");

  const [mode, setMode] = useState(null); // null | "split" | "edit"
  const [leaving, setLeaving] = useState([]);
  const [branchName, setBranchName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setMode(null);
    setLeaving([]);
    setBranchName("");
    setError("");
  }, [plan.id]);

  const going = partyMembers(plan.party, contributors);
  const forEveryone = !(plan.party ?? []).length;

  // The other groups over these same hours: what the people not on this
  // plan are doing instead. Read off the plans already loaded.
  const elsewhere = useMemo(() => {
    if (forEveryone || !plan.startsAt) return [];
    const start = Date.parse(plan.startsAt);
    const end = Date.parse(plan.endsAt);
    return plans
      .filter(
        (p) =>
          p.id !== plan.id &&
          p.status !== "draft" &&
          (p.party ?? []).length &&
          !partiesMeet(p.party, plan.party) &&
          Date.parse(p.startsAt) < end &&
          Date.parse(p.endsAt) > start
      )
      .map((p) => ({
        id: p.id,
        people: partyMembers(p.party, contributors),
        title: p.items.map((i) => i.title).join(" + ") || p.label || "nothing planned yet",
        until: p.endDt ? clockLabel(p.endDt.minuteOfDay) : "",
      }));
  }, [plans, plan, forEveryone, contributors]);

  async function run(action) {
    setBusy(true);
    setError("");
    const result = await dispatch(action);
    setBusy(false);
    if (!result.ok) setError(result.error || "Couldn't change who's going. Try again.");
    return result.ok;
  }

  async function confirmSplit() {
    if (busy) return;
    const ok = await run({ type: "SPLIT_PLAN", planId: plan.id, leaving, label: branchName.trim() });
    if (ok) {
      setMode(null);
      setLeaving([]);
      setBranchName("");
    }
  }

  function toggleOnBranch(person) {
    if (busy) return;
    const current = going.map((c) => c.id);
    const next = current.includes(person.id) ? current.filter((id) => id !== person.id) : [...current, person.id];
    if (!next.length) {
      setError("Someone has to be going. To cancel this plan instead, clear its start time above.");
      return;
    }
    run({ type: "SET_PLAN_PARTY", planId: plan.id, party: next });
  }

  const staying = going.filter((c) => !leaving.includes(c.id));
  const splitting = going.filter((c) => leaving.includes(c.id));
  const canSplit = editable && going.length > 1;
  const canJoinThis =
    canJoin &&
    !forEveryone &&
    !planIncludes(plan, me.id) &&
    (plan.status === "placed" || plan.status === "pencilled");

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <div className="mono-caption">Who&rsquo;s going</div>
        {!forEveryone && (
          <div className="mono-data-sm" style={{ color: "var(--text-muted)" }}>
            {going.length} of {contributors.length}
          </div>
        )}
      </div>

      {mode !== "split" && (
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {forEveryone ? (
            <>
              <AvatarStack contributors={contributors.slice(0, 6)} overflowCount={Math.max(0, contributors.length - 6)} size={24} />
              <span style={{ font: "500 13px var(--font-sans)", color: "var(--text-primary)" }}>Everyone</span>
            </>
          ) : mode === "edit" ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {contributors.map((c) => (
                <PersonChip key={c.id} person={c} on={going.some((g) => g.id === c.id)} onClick={() => toggleOnBranch(c)} disabled={busy} />
              ))}
            </div>
          ) : (
            <>
              <AvatarStack contributors={going} size={24} />
              <span style={{ font: "500 13px var(--font-sans)", color: "var(--text-primary)" }}>{namesOf(going)}</span>
            </>
          )}
        </div>
      )}

      {mode !== "split" &&
        elsewhere.map((e) => (
          <div key={e.id} className="mono-data-sm" style={{ marginTop: 6, color: "var(--text-muted)", letterSpacing: "0.03em" }}>
            {namesOf(e.people)}: {e.title}
            {e.until ? ` until ${e.until}` : ""}
          </div>
        ))}

      {mode === "split" && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ font: "400 12px var(--font-sans)", color: "var(--text-secondary)" }}>
            Tap the people going off to do something else from {clockLabel(startMin)} to {clockLabel(endMin)}.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <SplitColumn
              title="Stay on this"
              people={staying}
              tone="var(--teal-50)"
              onTap={(c) => setLeaving((l) => [...l, c.id])}
              disabled={busy}
            />
            <SplitColumn
              title="Go off together"
              people={splitting}
              tone="var(--plum-tint)"
              empty="Nobody yet"
              onTap={(c) => setLeaving((l) => l.filter((id) => id !== c.id))}
              disabled={busy}
            />
          </div>
          <input
            id="split-branch-name"
            type="text"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            placeholder="What are they doing? (optional)"
            aria-label="Name the new plan"
            style={{
              height: 42,
              padding: "0 12px",
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--border-strong)",
              background: "var(--surface-page)",
              font: "500 13px var(--font-sans)",
              color: "var(--text-primary)",
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => { setMode(null); setLeaving([]); setError(""); }} style={secondaryButton}>
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmSplit}
              disabled={busy || !splitting.length || !staying.length}
              style={{ ...primaryButton, opacity: busy || !splitting.length || !staying.length ? 0.5 : 1 }}
            >
              {busy ? "Splitting…" : `Split ${clockLabel(startMin)}–${clockLabel(endMin)}`}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: "var(--radius-lg)", background: "var(--warn-tint, #fdf1e6)", font: "500 12px var(--font-sans)", color: "var(--warn, #a15c1a)" }}>
          {error}
        </div>
      )}

      {mode === null && (canSplit || (editable && !forEveryone) || canJoinThis) && (
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {canJoinThis && (
            <button type="button" disabled={busy} onClick={() => run({ type: "JOIN_PLAN", planId: plan.id })} style={primaryButton}>
              {busy ? "Joining…" : "Join this group"}
            </button>
          )}
          {canSplit && (
            <button type="button" onClick={() => { setMode("split"); setError(""); }} style={secondaryButton}>
              Split the group
            </button>
          )}
          {editable && !forEveryone && (
            <>
              <button type="button" onClick={() => { setMode("edit"); setError(""); }} style={secondaryButton}>
                Change who&rsquo;s going
              </button>
              <button type="button" disabled={busy} onClick={() => run({ type: "SET_PLAN_PARTY", planId: plan.id, party: [] })} style={secondaryButton}>
                Bring everyone back
              </button>
            </>
          )}
        </div>
      )}
      {mode === "edit" && (
        <div style={{ marginTop: 10 }}>
          <button type="button" onClick={() => { setMode(null); setError(""); }} style={secondaryButton}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}

function PersonChip({ person, on, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px 3px 3px",
        borderRadius: 999,
        border: `1px solid ${on ? "var(--geo)" : "var(--border)"}`,
        background: on ? "var(--surface-card)" : "var(--surface-page)",
        opacity: on ? 1 : 0.6,
        font: "600 12px var(--font-sans)",
        color: "var(--text-primary)",
      }}
    >
      <span style={{ width: 20, height: 20, borderRadius: "50%", background: person.tint, display: "inline-flex", alignItems: "center", justifyContent: "center", font: "600 9px var(--font-sans)", color: "var(--text-secondary)" }}>
        {person.initial}
      </span>
      {person.name}
    </button>
  );
}

function SplitColumn({ title, people, tone, empty = "", onTap, disabled }) {
  return (
    <div style={{ background: tone, borderRadius: "var(--radius-lg)", padding: 10, minHeight: 110, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ font: "600 12px var(--font-sans)", color: "var(--text-primary)" }}>{title}</span>
        <span className="mono-data-sm" style={{ color: "var(--text-secondary)" }}>{people.length}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {people.map((c) => (
          <PersonChip key={c.id} person={c} on onClick={() => onTap(c)} disabled={disabled} />
        ))}
        {!people.length && empty && <span style={{ font: "400 11.5px var(--font-sans)", color: "var(--text-muted)" }}>{empty}</span>}
      </div>
    </div>
  );
}

const secondaryButton = {
  height: 40,
  padding: "0 14px",
  borderRadius: "var(--radius-lg)",
  background: "var(--surface-page)",
  border: "1px solid var(--border-strong)",
  color: "var(--text-primary)",
  font: "600 13px var(--font-sans)",
};

const primaryButton = {
  flex: 1,
  height: 40,
  padding: "0 14px",
  borderRadius: "var(--radius-lg)",
  background: "var(--surface-inverse)",
  color: "#fff",
  font: "600 13px var(--font-sans)",
};
