import { useEffect, useMemo, useState } from "react";
import AvatarStack from "./AvatarStack";
import { usePlannerDispatch, usePlannerState, useCan, useMyTraveler } from "../../state/PlannerContext";
import {
  branchName,
  branchesById,
  membersOf,
  namesOf,
  unassigned,
  withNewcomersGoingTo,
  withTravelerMoved,
} from "../../lib/splits";
import { clockLabel } from "../../lib/planTime";

// "Who's going" on a calendar item's details sheet — where the group
// splits up, where people move between the groups, and where everyone
// comes back together. See backend/app/splits.py for the model: a split
// is a stretch of hours with two or more groups, and a plan in those hours
// belongs to one group.
//
// A plan for everyone offers "Split the group" (plans:write): pick who
// goes off to do something else over this plan's hours. The plan stays
// with the people who stay; the others get a group of their own with
// nothing planned yet.
//
// A plan in a group shows the group and what the other groups are doing,
// and offers:
// - Join this group (plans:join, which companions have) — moves only you.
// - Change who's going (plans:write) — tap a face to move them into this
//   group, or out of it.
// - Where people added to the trip later go.
// - Bring everyone back (plans:write) — this group's plans become
//   everyone's, and the other groups' plans come off the calendar. Said
//   before it happens, by name.
export default function WhoIsGoing({ plan, editable }) {
  const { splits } = usePlannerState();
  const branch = useMemo(
    () => (plan.branchId != null ? branchesById(splits).get(plan.branchId) ?? null : null),
    [splits, plan.branchId]
  );
  return branch ? <GroupGoing plan={plan} branch={branch} /> : <EveryoneGoing plan={plan} editable={editable} />;
}

// Runs one split action, keeping its busy flag and the server's sentence.
function useSplitAction() {
  const dispatch = usePlannerDispatch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(action) {
    setBusy(true);
    setError("");
    const result = await dispatch(action);
    setBusy(false);
    if (!result?.ok) setError(result?.error || "Couldn't change who's going. Try again.");
    return Boolean(result?.ok);
  }
  return { busy, error, setError, run };
}

// ---- a plan for everyone ----------------------------------------------------

function EveryoneGoing({ plan, editable }) {
  const { travelers } = usePlannerState();
  const can = useCan();
  const { busy, error, setError, run } = useSplitAction();
  const [splitting, setSplitting] = useState(false);
  const [leaving, setLeaving] = useState([]);
  const [name, setName] = useState("");
  const [newcomers, setNewcomers] = useState("leave"); // "stay" | "leave" | "none"

  useEffect(() => {
    setSplitting(false);
    setLeaving([]);
    setName("");
    setNewcomers("leave");
    setError("");
  }, [plan.id, setError]);

  const staying = travelers.filter((t) => !leaving.includes(t.id));
  const going = travelers.filter((t) => leaving.includes(t.id));
  const canSplit = can("plans:write") && editable && travelers.length > 1;
  const hours = `${clockLabel(plan.startDt?.minuteOfDay ?? 0)}–${clockLabel(plan.endDt?.minuteOfDay ?? 0)}`;

  async function confirmSplit() {
    if (busy) return;
    const ok = await run({
      type: "CREATE_SPLIT",
      startsAt: plan.startsAt,
      endsAt: plan.endsAt,
      // This plan stays with the first group: the people who stay on it.
      keepPlansWith: 0,
      branches: [
        { label: "", traveler_ids: staying.map((t) => t.id), takes_newcomers: newcomers === "stay" },
        { label: name.trim(), traveler_ids: going.map((t) => t.id), takes_newcomers: newcomers === "leave" },
      ],
    });
    if (ok) setSplitting(false);
  }

  return (
    <div>
      <div className="mono-caption">Who&rsquo;s going</div>
      {!splitting && (
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}>
          <AvatarStack contributors={travelers.slice(0, 6)} overflowCount={Math.max(0, travelers.length - 6)} size={24} />
          <span style={{ font: "500 13px var(--font-sans)", color: "var(--text-primary)" }}>Everyone</span>
        </div>
      )}

      {splitting && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ font: "400 12px var(--font-sans)", color: "var(--text-secondary)" }}>
            Tap the people going off to do something else from {hours}.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <PeopleColumn title="Stay on this" people={staying} tone="var(--teal-50)" onTap={(t) => setLeaving((l) => [...l, t.id])} disabled={busy} />
            <PeopleColumn
              title="Go off together"
              people={going}
              tone="var(--plum-tint)"
              empty="Nobody yet"
              onTap={(t) => setLeaving((l) => l.filter((id) => id !== t.id))}
              disabled={busy}
            />
          </div>
          <Segmented
            caption="Anyone added to the trip later joins"
            value={newcomers}
            onChange={setNewcomers}
            options={[
              { value: "stay", label: "This plan" },
              { value: "leave", label: "The new group" },
              { value: "none", label: "Neither" },
            ]}
          />
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What are they doing? (optional)"
            aria-label="Name the new group"
            style={inputStyle}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => setSplitting(false)} style={secondaryButton}>
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmSplit}
              disabled={busy || !going.length || !staying.length}
              style={{ ...primaryButton, opacity: busy || !going.length || !staying.length ? 0.5 : 1 }}
            >
              {busy ? "Splitting…" : `Split ${hours}`}
            </button>
          </div>
        </div>
      )}

      <ErrorNote error={error} />

      {!splitting && canSplit && (
        <div style={{ marginTop: 10 }}>
          <button type="button" onClick={() => { setSplitting(true); setError(""); }} style={secondaryButton}>
            Split the group
          </button>
        </div>
      )}
    </div>
  );
}

// ---- a plan in one group ------------------------------------------------------

function GroupGoing({ plan, branch }) {
  const { plans, travelers } = usePlannerState();
  const can = useCan();
  const me = useMyTraveler();
  const { busy, error, setError, run } = useSplitAction();
  const [mode, setMode] = useState(null); // null | "edit" | "merge"
  const split = branch.split;

  useEffect(() => {
    setMode(null);
    setError("");
  }, [plan.id, setError]);

  const canWrite = can("plans:write");
  const going = membersOf(branch, travelers);
  const free = unassigned(split, travelers);
  const others = split.branches.filter((b) => b.id !== branch.id);

  // What each other group has on the calendar in this split — shown
  // beside this group, and named again before "bring everyone back"
  // takes it off.
  const plansByBranch = useMemo(() => {
    const map = new Map(split.branches.map((b) => [b.id, []]));
    plans
      .filter((p) => p.status !== "draft" && map.has(p.branchId))
      .forEach((p) => map.get(p.branchId).push(p));
    return map;
  }, [plans, split]);
  const titleOf = (p) => p.items.map((i) => i.title).join(" + ") || p.label || "Untitled";
  const doomed = others.flatMap((b) => plansByBranch.get(b.id) ?? []);

  function toggle(person) {
    if (busy) return;
    const inHere = branch.travelerIds.includes(person.id);
    if (inHere && branch.travelerIds.length === 1) {
      setError("Someone has to stay in this group. To end the split, bring everyone back instead.");
      return;
    }
    run({ type: "RESHAPE_SPLIT", splitId: split.id, branches: withTravelerMoved(split, person.id, inHere ? null : branch.id) });
  }

  const canJoinThis = can("plans:join") && me != null && !branch.travelerIds.includes(me.id);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <div className="mono-caption">Who&rsquo;s going</div>
        <div className="mono-data-sm" style={{ color: "var(--text-muted)" }}>
          {going.length} of {travelers.length}
        </div>
      </div>

      {mode === "edit" ? (
        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {travelers.map((t) => (
            <PersonChip key={t.id} person={t} on={branch.travelerIds.includes(t.id)} onClick={() => toggle(t)} disabled={busy} />
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <AvatarStack contributors={going} size={24} />
          <span style={{ font: "500 13px var(--font-sans)", color: "var(--text-primary)" }}>
            {branch.label ? `${branch.label} · ${namesOf(going)}` : namesOf(going)}
          </span>
        </div>
      )}

      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ font: "400 11.5px var(--font-sans)", color: branch.takesNewcomers ? "var(--accent)" : "var(--text-muted)" }}>
          {branch.takesNewcomers
            ? "Anyone added to the trip later joins this group."
            : "People added to the trip later won’t join this group."}
        </span>
        {canWrite && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run({ type: "RESHAPE_SPLIT", splitId: split.id, branches: withNewcomersGoingTo(split, branch.takesNewcomers ? null : branch.id) })
            }
            style={linkButton}
          >
            {branch.takesNewcomers ? "Stop" : "Send them here"}
          </button>
        )}
      </div>

      {others.map((b) => (
        <div key={b.id} className="mono-data-sm" style={elsewhereLine}>
          {branchName(b, travelers)}: {(plansByBranch.get(b.id) ?? []).map(titleOf).join(", ") || "nothing planned yet"}
        </div>
      ))}
      {free.length > 0 && (
        <div className="mono-data-sm" style={elsewhereLine}>
          {namesOf(free)}: free, in neither group
        </div>
      )}

      {mode === "merge" && (
        <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: "var(--radius-lg)", background: "var(--surface-sunken)", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ font: "400 12.5px/1.5 var(--font-sans)", color: "var(--text-primary)" }}>
            Everyone goes with <strong>{branchName(branch, travelers)}</strong> from {clockLabel(split.startDt?.minuteOfDay ?? 0)} to{" "}
            {clockLabel(split.endDt?.minuteOfDay ?? 0)}.{" "}
            {doomed.length
              ? `${doomed.map(titleOf).join(", ")} ${doomed.length === 1 ? "comes" : "come"} off the calendar.`
              : "Nothing else is planned then, so nothing comes off the calendar."}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => setMode(null)} style={secondaryButton}>
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => run({ type: "MERGE_SPLIT", splitId: split.id, keepBranchId: branch.id })}
              style={primaryButton}
            >
              {busy ? "Bringing everyone back…" : "Bring everyone back"}
            </button>
          </div>
        </div>
      )}

      <ErrorNote error={error} />

      {mode === null && (canJoinThis || canWrite) && (
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {canJoinThis && (
            <button type="button" disabled={busy} onClick={() => run({ type: "JOIN_BRANCH", branchId: branch.id })} style={primaryButton}>
              {busy ? "Joining…" : "Join this group"}
            </button>
          )}
          {canWrite && (
            <>
              <button type="button" onClick={() => { setMode("edit"); setError(""); }} style={secondaryButton}>
                Change who&rsquo;s going
              </button>
              <button type="button" onClick={() => { setMode("merge"); setError(""); }} style={secondaryButton}>
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

// ---- pieces -------------------------------------------------------------------

function ErrorNote({ error }) {
  if (!error) return null;
  return (
    <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: "var(--radius-lg)", background: "var(--warn-tint, #fdf1e6)", font: "500 12px var(--font-sans)", color: "var(--warn, #a15c1a)" }}>
      {error}
    </div>
  );
}

function Segmented({ caption, value, onChange, options }) {
  return (
    <div>
      <div className="mono-caption" style={{ marginBottom: 6 }}>{caption}</div>
      <div role="group" aria-label={caption} style={{ display: "flex", background: "var(--surface-sunken)", borderRadius: "var(--radius-md)", padding: 2 }}>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            aria-pressed={value === opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              flex: 1,
              padding: "6px 0",
              borderRadius: "calc(var(--radius-md) - 2px)",
              background: value === opt.value ? "var(--surface-card)" : "transparent",
              boxShadow: value === opt.value ? "var(--shadow-raised)" : "none",
              font: "600 11.5px var(--font-sans)",
              color: value === opt.value ? "var(--text-primary)" : "var(--text-secondary)",
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
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

function PeopleColumn({ title, people, tone, empty = "", onTap, disabled }) {
  return (
    <div style={{ background: tone, borderRadius: "var(--radius-lg)", padding: 10, minHeight: 110, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ font: "600 12px var(--font-sans)", color: "var(--text-primary)" }}>{title}</span>
        <span className="mono-data-sm" style={{ color: "var(--text-secondary)" }}>{people.length}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {people.map((p) => (
          <PersonChip key={p.id} person={p} on onClick={() => onTap(p)} disabled={disabled} />
        ))}
        {!people.length && empty && <span style={{ font: "400 11.5px var(--font-sans)", color: "var(--text-muted)" }}>{empty}</span>}
      </div>
    </div>
  );
}

const elsewhereLine = { marginTop: 6, color: "var(--text-muted)", letterSpacing: "0.03em" };

const linkButton = { font: "600 11.5px var(--font-sans)", color: "var(--accent)" };

const inputStyle = {
  height: 42,
  padding: "0 12px",
  borderRadius: "var(--radius-lg)",
  border: "1px solid var(--border-strong)",
  background: "var(--surface-page)",
  font: "500 13px var(--font-sans)",
  color: "var(--text-primary)",
};

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
