import { useMemo, useState } from "react";
import Button from "../core/Button";
import { Avatar } from "./PeopleList";
import { MiniStack, RoleSheet } from "./PersonPicks";
import { textFieldStyle } from "../forms/TextField";
import { roleLabel } from "../../lib/roles";
import { firstName, matchesQuery, openSpots, sameNameSpot, sharedTripsLine, suggestedRole, tripGroups } from "../../lib/people";
import { usePlannerDispatch, usePlannerState } from "../../state/PlannerContext";

// "Your people" in an existing trip's Invite sheet (InviteSheet.jsx):
// invite people you've planned with by name, the way a new trip's
// "Who's coming with you?" step does (components/newtrip/WhoIsPlanning.jsx).
//
// - Everyone already on the trip, or with an invite waiting, is shown but
//   can't be picked.
// - Someone coming who has the same first name as exactly one listed
//   traveler without an account ("Jonah") swaps in for them: joining
//   claims that row, with its groups, costs and who pays. Anyone else
//   coming is added as a new traveler. To swap someone in for a
//   different listed traveler ("Traveler 5"), edit that traveler on the
//   roster (components/travelers/TravelerSheet.jsx).
//
// `waiting` is the trip's unanswered direct invites (GET
// /api/trips/{id}/direct-invites); `onSent` re-reads it.
export default function InvitePeopleTab({ trip, people, waiting, onSent, onUseLink }) {
  const { contributors, travelers } = usePlannerState();
  const dispatch = usePlannerDispatch();
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState({}); // email -> { role, traveling }
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentLine, setSentLine] = useState("");

  const list = useMemo(() => people ?? [], [people]);
  const byEmail = useMemo(() => new Map(list.map((p) => [p.email, p])), [list]);
  const members = useMemo(() => new Set(contributors.map((c) => c.email)), [contributors]);
  const waitingEmails = useMemo(() => new Set(waiting.map((i) => i.email)), [waiting]);
  const available = (p) => !members.has(p.email) && !waitingEmails.has(p.email);

  // Which listed traveler each pick coming swaps in for, in list order,
  // so two people never land on the same spot.
  const swaps = useMemo(() => {
    const taken = new Set(waiting.map((i) => i.traveler_id).filter((id) => id != null));
    const out = {};
    for (const p of list) {
      const pick = chosen[p.email];
      if (!pick?.traveling) continue;
      const spot = sameNameSpot(p, openSpots(travelers, taken));
      if (spot) {
        out[p.email] = spot;
        taken.add(spot.id);
      }
    }
    return out;
  }, [list, chosen, travelers, waiting]);

  // Trips to tick a whole group from: everyone from them who can still
  // be invited, leaving out this trip itself.
  const groups = tripGroups(list.filter(available)).filter((g) => g.id !== trip.id);
  const shown = list.filter((p) => matchesQuery(p, query));
  const count = Object.keys(chosen).length;

  function toggle(person) {
    const next = { ...chosen };
    if (next[person.email]) delete next[person.email];
    else next[person.email] = { role: suggestedRole(person), traveling: true };
    setChosen(next);
    setSentLine("");
  }

  function toggleGroup(group) {
    const allIn = group.emails.every((email) => chosen[email]);
    const next = { ...chosen };
    for (const email of group.emails) {
      if (allIn) delete next[email];
      else if (!next[email]) next[email] = { role: suggestedRole(byEmail.get(email)), traveling: true };
    }
    setChosen(next);
    setSentLine("");
  }

  async function send() {
    if (!count || busy) return;
    setBusy(true);
    setError("");
    const invitees = Object.entries(chosen).map(([email, { role, traveling }]) => ({
      email,
      role,
      traveling,
      ...(traveling && swaps[email] ? { traveler_id: swaps[email].id } : {}),
    }));
    const result = await dispatch({ type: "SEND_DIRECT_INVITES", invitees });
    setBusy(false);
    if (!result.ok) {
      setError(result.error || "Couldn't send the invites. Try again.");
      return;
    }
    const names = Object.keys(chosen).map((email) => firstName(byEmail.get(email) ?? { display_name: email }));
    setSentLine(`Invite${names.length === 1 ? "" : "s"} sent to ${joinNames(names)}.`);
    setChosen({});
    onSent?.();
  }

  if (list.length === 0) {
    return (
      <div style={{ font: "400 13px var(--font-sans)", color: "var(--text-secondary)", padding: "0 4px", display: "flex", flexDirection: "column", gap: 12 }}>
        <span>Nobody you&rsquo;ve planned a trip with yet. Send a link instead, and they&rsquo;ll be here next time.</span>
        <Button variant="secondary" onClick={onUseLink}>
          Send a link
        </Button>
      </div>
    );
  }

  const editingPerson = editing ? byEmail.get(editing) : null;

  return (
    <>
      <input
        type="search"
        aria-label="Search your people"
        placeholder="Search your people"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ ...textFieldStyle(), flex: "none" }}
      />

      {groups.length > 0 && !query.trim() ? (
        <>
          <div className="mono-caption" style={{ padding: "0 4px", marginBottom: -6 }}>
            Everyone from a trip
          </div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", flex: "none" }}>
            {groups.map((g) => {
              const allIn = g.emails.every((email) => chosen[email]);
              return (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={allIn}
                  onClick={() => toggleGroup(g)}
                  style={{
                    flex: "none",
                    height: 40,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "0 12px 0 8px",
                    borderRadius: "var(--radius-pill)",
                    border: allIn ? "1.5px solid var(--accent)" : "1px solid var(--border-strong)",
                    background: allIn ? "var(--accent-quiet)" : "var(--surface-card)",
                    font: "600 12.5px var(--font-sans)",
                    color: "var(--text-primary)",
                  }}
                >
                  <MiniStack people={g.emails.map((email) => byEmail.get(email))} />
                  {g.name} · {g.emails.length}
                </button>
              );
            })}
          </div>
        </>
      ) : null}

      <div className="mono-caption" style={{ padding: "0 4px", marginBottom: -6 }}>
        Your people{count ? ` · ${count} selected` : ""}
      </div>
      {shown.length === 0 ? (
        <div style={{ font: "400 13px var(--font-sans)", color: "var(--text-muted)", padding: "0 4px" }}>No one matches.</div>
      ) : (
        <div
          style={{
            background: "var(--surface-card)",
            borderRadius: "var(--radius-xl)",
            border: "1px solid var(--hairline)",
            overflow: "hidden",
            flex: "none",
          }}
        >
          {shown.map((p, i) => {
            const pick = chosen[p.email];
            const open = available(p);
            const spot = swaps[p.email];
            const note = !open
              ? members.has(p.email)
                ? `Already on ${trip.name}`
                : "Invite waiting"
              : sharedTripsLine(p);
            return (
              <div
                key={p.email}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 12px",
                  minHeight: 58,
                  borderTop: i === 0 ? "none" : "1px solid var(--hairline)",
                  opacity: open ? 1 : 0.5,
                }}
              >
                <label style={{ display: "flex", alignItems: "center", gap: 11, flex: 1, minWidth: 0, cursor: open ? "pointer" : "default" }}>
                  <input
                    type="checkbox"
                    checked={Boolean(pick)}
                    disabled={!open}
                    onChange={() => toggle(p)}
                    style={{ width: 20, height: 20, accentColor: "var(--accent)", margin: 0, flex: "none", visibility: open ? "visible" : "hidden" }}
                  />
                  <Avatar person={p} size={34} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", font: "600 14px var(--font-sans)", color: "var(--text-primary)" }}>{p.display_name}</span>
                    <span style={{ display: "block", font: "400 12px var(--font-sans)", color: "var(--text-secondary)", marginTop: 1 }}>{note}</span>
                    {pick ? (
                      <span style={{ display: "block", font: "500 11px var(--font-mono)", color: "var(--accent)", marginTop: 2 }}>
                        {!pick.traveling ? "Helping plan, not going" : spot ? `↻ as ${spot.name}, already listed` : "+ new traveler"}
                      </span>
                    ) : null}
                  </span>
                </label>
                {pick ? (
                  <button
                    type="button"
                    onClick={() => setEditing(p.email)}
                    aria-label={`${p.display_name}'s role: ${roleLabel(pick.role)}${pick.traveling ? "" : ", not coming"}. Change`}
                    style={{
                      flex: "none",
                      height: 32,
                      padding: "0 10px",
                      borderRadius: "var(--radius-pill)",
                      background: "var(--accent-quiet)",
                      border: "1px solid var(--plum-tint-strong)",
                      color: "var(--accent)",
                      font: "600 12px var(--font-sans)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    {roleLabel(pick.role)}
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      <div style={{ font: "var(--type-caption)", color: "var(--text-muted)", padding: "0 4px", marginTop: -6 }}>
        To swap someone in for a different listed traveler, tap that traveler on the roster.
      </div>

      {error ? (
        <div role="alert" style={{ font: "500 12.5px var(--font-sans)", color: "var(--warn)", padding: "0 4px" }}>
          {error}
        </div>
      ) : null}
      {sentLine ? (
        <div role="status" style={{ font: "500 12.5px var(--font-sans)", color: "var(--accent)", padding: "0 4px" }}>
          {sentLine}
        </div>
      ) : null}

      <Button variant="primary" onClick={send} disabled={!count || busy}>
        {busy ? "Sending…" : count ? `Send ${count} ${count === 1 ? "invite" : "invites"}` : "Pick someone to invite"}
      </Button>

      {editingPerson && chosen[editing] ? (
        <RoleSheet
          person={editingPerson}
          tripName={trip.name}
          pick={chosen[editing]}
          swapName={swaps[editing]?.name}
          onChange={(pick) => setChosen({ ...chosen, [editing]: pick })}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function joinNames(names) {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
