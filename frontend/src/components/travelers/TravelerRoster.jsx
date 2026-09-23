import { useMemo, useState } from "react";
import { Avatar } from "../sharing/PeopleList";
import { usePlannerDispatch, usePlannerState, useCan, useMyTraveler } from "../../state/PlannerContext";
import { roleLabel } from "../../lib/roles";
import TravelerSheet from "./TravelerSheet";

// Who is going (backend Traveler) — shown in Trip settings and on Trip
// info. Not the same list as People: a child or a grandparent is going
// without an account, and a planner can help without going. Costs are
// split between travelers, and groups on a split day are made of them.
//
// Rows are grouped by who pays, so a household reads as one unit: the
// payer, then the people they pay for. Planners (travelers:manage) add,
// edit and remove anyone; everyone else can edit only their own row (name
// and who pays for them).
export default function TravelerRoster() {
  const { travelers, contributors, currentUserId } = usePlannerState();
  const dispatch = usePlannerDispatch();
  const can = useCan();
  const me = useMyTraveler();
  const canManage = can("travelers:manage");
  const [editing, setEditing] = useState(null); // null | "new" | traveler
  const [error, setError] = useState("");

  const membersById = useMemo(() => Object.fromEntries(contributors.map((c) => [c.id, c])), [contributors]);
  const byId = useMemo(() => Object.fromEntries(travelers.map((t) => [t.id, t])), [travelers]);

  // Households: each traveler who pays for themselves, followed by the
  // people they pay for. Someone pointing at a payer who's gone just
  // stands on their own.
  const ordered = useMemo(() => {
    const out = [];
    const payers = travelers.filter((t) => t.paidById == null || !byId[t.paidById]);
    payers.forEach((p) => {
      out.push({ traveler: p, covered: false });
      travelers.filter((t) => t.paidById === p.id).forEach((t) => out.push({ traveler: t, covered: true }));
    });
    return out;
  }, [travelers, byId]);

  const notGoing = contributors.filter((c) => !travelers.some((t) => t.contributorId === c.id));

  async function addMember(member) {
    setError("");
    const result = await dispatch({ type: "CREATE_TRAVELER", payload: { name: member.name, contributor_id: member.id } });
    if (!result.ok) setError(result.error || "Couldn't add them.");
  }

  function status(t) {
    const member = t.contributorId != null ? membersById[t.contributorId] : null;
    if (member) {
      const you = member.id === currentUserId ? " · you" : "";
      return { sub: `${roleLabel(member.role)}${you}`, tag: "On app", tone: "app" };
    }
    if (t.invited) return { sub: "Invite sent", tag: "Invited", tone: "invited" };
    return { sub: "No account", tag: "Listed", tone: "listed" };
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <span className="mono-caption">Travelers · {travelers.length}</span>
        <span className="mono-caption">Paid by</span>
      </div>
      <div style={{ background: "var(--surface-card)", borderRadius: "var(--radius-xl)", border: "1px solid var(--hairline)", overflow: "hidden" }}>
        {ordered.map(({ traveler: t, covered }, i) => {
          const s = status(t);
          const payer = byId[t.paidById] ?? t;
          const mine = me?.id === t.id;
          const tappable = canManage || mine;
          return (
            <button
              key={t.id}
              type="button"
              disabled={!tappable}
              onClick={() => setEditing(t)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: covered ? "9px 14px 9px 30px" : "9px 14px",
                borderTop: i === 0 ? "none" : "1px solid var(--hairline)",
                textAlign: "left",
                cursor: tappable ? "pointer" : "default",
              }}
            >
              <Avatar person={t} size={28} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: "var(--type-label)", color: "var(--text-primary)" }}>{t.name}</div>
                <div className="mono-data-sm" style={{ color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {s.sub}
                </div>
              </div>
              <span
                className="mono-data-sm"
                style={{
                  padding: "3px 6px",
                  borderRadius: 6,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  background: s.tone === "app" ? "var(--teal-50)" : s.tone === "invited" ? "var(--plum-tint-strong)" : "var(--surface-sunken)",
                  color: s.tone === "app" ? "var(--geo)" : s.tone === "invited" ? "var(--accent)" : "var(--text-secondary)",
                }}
              >
                {s.tag}
              </span>
              <span title={`Paid by ${payer.name}`}>
                <Avatar person={payer} size={20} />
              </span>
            </button>
          );
        })}
        {travelers.length === 0 && (
          <div style={{ padding: "14px", font: "var(--type-body-sm)", color: "var(--text-muted)" }}>
            Nobody is listed as going yet.
          </div>
        )}
      </div>

      {canManage && (
        <button
          type="button"
          onClick={() => setEditing("new")}
          style={{
            border: "1.5px dashed var(--border-strong)",
            borderRadius: "var(--radius-xl)",
            padding: "11px",
            font: "600 12.5px var(--font-sans)",
            color: "var(--accent)",
          }}
        >
          + Add a traveler
        </button>
      )}
      <div style={{ font: "var(--type-caption)", color: "var(--text-muted)" }}>
        Costs are split between travelers, whether or not they&rsquo;re on the app.
      </div>

      {notGoing.length > 0 && (
        <>
          <span className="mono-caption" style={{ marginTop: 8 }}>Planning, not going · {notGoing.length}</span>
          <div style={{ background: "var(--surface-card)", borderRadius: "var(--radius-xl)", border: "1px solid var(--hairline)", overflow: "hidden" }}>
            {notGoing.map((c, i) => (
              <div
                key={c.id}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderTop: i === 0 ? "none" : "1px solid var(--hairline)" }}
              >
                <Avatar person={c} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: "var(--type-label)", color: "var(--text-primary)" }}>{c.name}</div>
                  <div className="mono-data-sm" style={{ color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {roleLabel(c.role)} · not on any group or cost
                  </div>
                </div>
                {canManage && (
                  <button type="button" onClick={() => addMember(c)} style={{ font: "600 12px var(--font-sans)", color: "var(--accent)" }}>
                    Add as traveler
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {error ? <div style={{ font: "500 12.5px var(--font-sans)", color: "#b3423a" }}>{error}</div> : null}

      {editing && (
        <TravelerSheet traveler={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
