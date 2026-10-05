import { useMemo, useState } from "react";
import Button from "../core/Button";
import BottomSheet from "../core/BottomSheet";
import { Avatar } from "../sharing/PeopleList";
import { textFieldStyle } from "../forms/TextField";
import { GRANTABLE_ROLES, ROLES, roleLabel } from "../../lib/roles";
import { firstName, matchesQuery, sharedTripsLine, suggestedRole, tripGroups } from "../../lib/people";

// Step 2 of the new-trip form (pages/NewTrip.jsx): pick people you've
// planned with before, each with a role, and they're invited as the trip
// is created. The invite waits on their Trips screen (components/sharing/
// WaitingInvites.jsx); nobody is on the trip until they say yes.
//
// - "Everyone from a trip" ticks a past trip's whole group at once.
// - Ticking someone suggests the role they had last time; the role chip
//   opens a sheet to change it, and to say whether they're coming (a
//   traveler) or only helping plan.
// - Someone new isn't here: once the trip exists, Trip settings has a link
//   for them.
//
// `chosen` maps email -> { role, traveling } and is owned by the form, so
// going Back to step 1 and returning keeps the picks.
export default function WhoIsPlanning({ tripName, people, chosen, onChange, onBack, onSkip, onCreate, submitting, error }) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null); // email whose role sheet is open

  const list = useMemo(() => people ?? [], [people]);
  const byEmail = useMemo(() => new Map(list.map((p) => [p.email, p])), [list]);
  const groups = useMemo(() => tripGroups(list), [list]);
  const shown = list.filter((p) => matchesQuery(p, query));
  const count = Object.keys(chosen).length;

  function toggle(person) {
    const next = { ...chosen };
    if (next[person.email]) delete next[person.email];
    else next[person.email] = { role: suggestedRole(person), traveling: true };
    onChange(next);
  }

  // A trip's chip ticks everyone from it; tapped again once they're all
  // ticked, it unticks them.
  function toggleGroup(group) {
    const allIn = group.emails.every((email) => chosen[email]);
    const next = { ...chosen };
    for (const email of group.emails) {
      if (allIn) delete next[email];
      else if (!next[email]) next[email] = { role: suggestedRole(byEmail.get(email)), traveling: true };
    }
    onChange(next);
  }

  const editingPerson = editing ? byEmail.get(editing) : null;

  return (
    <div className="screen" style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 16px 4px" }}>
        <button
          type="button"
          className="hit-target"
          onClick={onBack}
          disabled={submitting}
          style={{ font: "500 13px var(--font-sans)", color: "var(--accent)", textAlign: "left" }}
        >
          ‹ Back
        </button>
        <span className="mono-caption">New trip · 2 of 2</span>
        <button
          type="button"
          className="hit-target"
          onClick={onSkip}
          disabled={submitting}
          style={{ font: "500 13px var(--font-sans)", color: "var(--text-secondary)", textAlign: "right" }}
        >
          Skip
        </button>
      </div>

      <div className="screen-scroll" style={{ paddingBottom: 16 }}>
        <div style={{ padding: "8px var(--gutter-text) 0" }}>
          <h1 className="serif-place" style={{ fontSize: 24, lineHeight: 1.2, color: "var(--text-primary)" }}>
            Who&rsquo;s planning {tripName} with you?
          </h1>
          <div style={{ font: "400 12.5px var(--font-sans)", color: "var(--text-secondary)", marginTop: 4 }}>
            They&rsquo;ll get an invite on their Trips screen.
          </div>
        </div>

        {people === null ? (
          <div style={{ padding: "18px var(--gutter-text)", font: "400 13px var(--font-sans)", color: "var(--text-muted)" }}>
            Loading your people…
          </div>
        ) : (
          <>
            <div style={{ padding: "14px var(--gutter-screen) 0" }}>
              <input
                type="search"
                aria-label="Search your people"
                placeholder="Search your people"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={textFieldStyle()}
              />
            </div>

            {groups.length > 0 && !query.trim() ? (
              <>
                <div className="mono-caption" style={{ padding: "16px var(--gutter-text) 8px" }}>
                  Everyone from a trip
                </div>
                <div style={{ display: "flex", gap: 8, padding: "0 var(--gutter-screen)", overflowX: "auto" }}>
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

            <div className="mono-caption" style={{ padding: "18px var(--gutter-text) 8px" }}>
              Your people{count ? ` · ${count} selected` : ""}
            </div>
            <div style={{ padding: "0 var(--gutter-screen)" }}>
              {shown.length === 0 ? (
                <div style={{ font: "400 13px var(--font-sans)", color: "var(--text-muted)", padding: "4px 4px 8px" }}>
                  No one matches.
                </div>
              ) : (
                <div
                  style={{
                    background: "var(--surface-card)",
                    borderRadius: "var(--radius-xl)",
                    border: "1px solid var(--hairline)",
                    overflow: "hidden",
                  }}
                >
                  {shown.map((p, i) => {
                    const pick = chosen[p.email];
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
                        }}
                      >
                        <label style={{ display: "flex", alignItems: "center", gap: 11, flex: 1, minWidth: 0, cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={Boolean(pick)}
                            onChange={() => toggle(p)}
                            style={{ width: 20, height: 20, accentColor: "var(--accent)", margin: 0, flex: "none" }}
                          />
                          <Avatar person={p} size={34} />
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: "block", font: "600 14px var(--font-sans)", color: "var(--text-primary)" }}>
                              {p.display_name}
                            </span>
                            <span style={{ display: "block", font: "400 12px var(--font-sans)", color: "var(--text-secondary)", marginTop: 1 }}>
                              {sharedTripsLine(p)}
                            </span>
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
                            {pick.traveling ? "" : " · planning"}
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
              <div style={{ font: "400 11.5px var(--font-sans)", color: "var(--text-muted)", padding: "10px 4px 0" }}>
                Someone new? Once {tripName} exists, Trip settings has a link you can send them.
              </div>
            </div>
          </>
        )}
      </div>

      <div
        style={{
          flex: "none",
          background: "var(--surface-card)",
          borderTop: "1px solid var(--hairline)",
          padding: "12px 16px calc(14px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        {error ? (
          <div role="alert" style={{ font: "500 12.5px var(--font-sans)", color: "var(--warn)", marginBottom: 10 }}>
            {error}
          </div>
        ) : null}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, font: "400 12.5px var(--font-sans)", color: "var(--text-secondary)" }}>
            {count === 0 ? "No one picked yet" : `${count} ${count === 1 ? "invite" : "invites"}`}
          </div>
          <Button variant="primary" fullWidth={false} onClick={onCreate} disabled={submitting} style={{ padding: "0 22px" }}>
            {submitting ? "Creating…" : "Create trip"}
          </Button>
        </div>
      </div>

      {editingPerson && chosen[editing] ? (
        <RoleSheet
          person={editingPerson}
          tripName={tripName}
          pick={chosen[editing]}
          onChange={(pick) => onChange({ ...chosen, [editing]: pick })}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function MiniStack({ people }) {
  const shown = people.filter(Boolean).slice(0, 3);
  return (
    <span style={{ display: "flex" }} aria-hidden="true">
      {shown.map((p, i) => (
        <span
          key={p.email}
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: p.tint,
            border: "2px solid var(--surface-card)",
            marginLeft: i === 0 ? 0 : -7,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            font: "600 9px var(--font-sans)",
            color: "var(--text-secondary)",
          }}
        >
          {p.initial}
        </span>
      ))}
    </span>
  );
}

// One person's role on the new trip, and whether they're coming. Changes
// apply as they're made; Done just closes.
function RoleSheet({ person, tripName, pick, onChange, onClose }) {
  const name = firstName(person);
  const lastTime = GRANTABLE_ROLES.includes(person.last_role) ? person.last_role : null;
  const lastTrip = person.trips[0]?.name;
  return (
    <BottomSheet label={`${name}'s role on ${tripName}`} onClose={onClose}>
      <div style={{ padding: "8px 16px calc(20px + env(safe-area-inset-bottom, 0px))", overflowY: "auto" }}>
        <div className="serif-place" style={{ fontSize: 22, color: "var(--text-primary)" }}>
          {name}&rsquo;s role on {tripName}
        </div>
        {lastTime && lastTrip ? (
          <div style={{ font: "400 12.5px var(--font-sans)", color: "var(--text-secondary)", marginTop: 2 }}>
            {name} was a {roleLabel(lastTime).toLowerCase()} on {lastTrip}.
          </div>
        ) : null}

        <div role="radiogroup" aria-label="Role" style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
          {GRANTABLE_ROLES.map((role) => {
            const on = pick.role === role;
            return (
              <label
                key={role}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: 12,
                  borderRadius: "var(--radius-lg)",
                  border: on ? "1.5px solid var(--accent)" : "1px solid var(--border)",
                  background: on ? "var(--accent-quiet)" : "var(--surface-card)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="invite-role"
                  checked={on}
                  onChange={() => onChange({ ...pick, role })}
                  style={{ width: 18, height: 18, accentColor: "var(--accent)", margin: "1px 0 0", flex: "none" }}
                />
                <span>
                  <span style={{ font: "600 14px var(--font-sans)", color: "var(--text-primary)" }}>{ROLES[role].label}</span>
                  {role === lastTime ? (
                    <span
                      className="mono-caption"
                      style={{ marginLeft: 8, padding: "3px 6px", borderRadius: 4, background: "var(--surface-sunken)", color: "var(--stone-700)" }}
                    >
                      Last time
                    </span>
                  ) : null}
                  <span style={{ display: "block", font: "400 12px/1.45 var(--font-sans)", color: "var(--text-secondary)", marginTop: 3 }}>
                    {ROLES[role].invite}
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 16, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={pick.traveling}
            onChange={(e) => onChange({ ...pick, traveling: e.target.checked })}
            style={{ width: 18, height: 18, accentColor: "var(--accent)", margin: "1px 0 0", flex: "none" }}
          />
          <span>
            <span style={{ display: "block", font: "600 13px var(--font-sans)", color: "var(--text-primary)" }}>
              {name} is coming on the trip
            </span>
            <span style={{ display: "block", font: "400 12px var(--font-sans)", color: "var(--text-secondary)", marginTop: 2 }}>
              Lists them as a traveler, so shared costs include them. Turn off for someone who&rsquo;s only helping plan.
            </span>
          </span>
        </label>

        <div style={{ marginTop: 18 }}>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
