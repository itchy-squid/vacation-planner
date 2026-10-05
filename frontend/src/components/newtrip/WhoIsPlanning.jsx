import { useMemo, useState } from "react";
import Button from "../core/Button";
import BottomSheet from "../core/BottomSheet";
import { Avatar } from "../sharing/PeopleList";
import { MiniStack, RoleSheet } from "../sharing/PersonPicks";
import { textFieldStyle } from "../forms/TextField";
import { roleLabel } from "../../lib/roles";
import {
  firstName,
  lastPayer,
  matchesQuery,
  resolvePayer,
  sharedTripsLine,
  suggestedRole,
  tripGroups,
} from "../../lib/people";

// Step 2 of the new-trip form (pages/NewTrip.jsx): who's coming. Two
// kinds of people, in one list:
//
// - People you've planned with before, each with a role. They're invited
//   as the trip is created, and the invite waits on their Trips screen
//   (components/sharing/WaitingInvites.jsx); nobody is on the trip until
//   they say yes.
// - People who came on your trips without an account, like a child or a
//   grandparent (GET /api/people/travelers). Ticking one lists them as a
//   traveler; nobody is invited. Who paid for them last time carries
//   over while that person is coming too, otherwise you pay.
//
// - "Everyone from a trip" ticks a past trip's whole group at once.
// - Ticking someone suggests the role they had last time; the role chip
//   opens a sheet to change it, and to say whether they're coming (a
//   traveler) or only helping plan. A past traveler's chip is who pays.
// - Someone new isn't here: once the trip exists, Trip settings has a link
//   for them.
//
// `chosen` maps email -> { role, traveling } and `listed` maps a past
// traveler's key -> { paidBy } ("me", an email, or null for their own
// way). Both are owned by the form, so going Back to step 1 and returning
// keeps the picks.
export default function WhoIsPlanning({
  tripName,
  people,
  pastTravelers,
  chosen,
  onChange,
  listed,
  onListedChange,
  onBack,
  onSkip,
  onCreate,
  submitting,
  error,
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null); // email whose role sheet is open
  const [editingListed, setEditingListed] = useState(null); // key whose payer sheet is open

  const list = useMemo(() => people ?? [], [people]);
  const past = useMemo(() => pastTravelers ?? [], [pastTravelers]);
  const byEmail = useMemo(() => new Map(list.map((p) => [p.email, p])), [list]);
  const byKey = useMemo(() => new Map(past.map((t) => [t.key, t])), [past]);
  const groups = useMemo(() => tripGroups(list, past), [list, past]);
  const shown = list.filter((p) => matchesQuery(p, query));
  const shownPast = past.filter((t) => matchesTraveler(t, query));
  const invites = Object.keys(chosen).length;
  const listedCount = Object.keys(listed).length;
  const count = invites + listedCount;

  function toggle(person) {
    const next = { ...chosen };
    if (next[person.email]) delete next[person.email];
    else next[person.email] = { role: suggestedRole(person), traveling: true };
    onChange(next);
  }

  function toggleListed(traveler) {
    const next = { ...listed };
    if (next[traveler.key]) delete next[traveler.key];
    else next[traveler.key] = { paidBy: lastPayer(traveler) };
    onListedChange(next);
  }

  // A trip's chip ticks everyone from it; tapped again once they're all
  // ticked, it unticks them.
  function toggleGroup(group) {
    const allIn = group.emails.every((email) => chosen[email]) && group.travelerKeys.every((key) => listed[key]);
    const nextChosen = { ...chosen };
    for (const email of group.emails) {
      if (allIn) delete nextChosen[email];
      else if (!nextChosen[email]) nextChosen[email] = { role: suggestedRole(byEmail.get(email)), traveling: true };
    }
    const nextListed = { ...listed };
    for (const key of group.travelerKeys) {
      if (allIn) delete nextListed[key];
      else if (!nextListed[key]) nextListed[key] = { paidBy: lastPayer(byKey.get(key)) };
    }
    onChange(nextChosen);
    onListedChange(nextListed);
  }

  // "You pay", "Mei pays", "Pays their own way" — after the fallback to
  // you when the payer picked isn't coming.
  function payerLabel(paidBy) {
    const resolved = resolvePayer(paidBy, chosen);
    if (resolved === "me") return "You pay";
    if (resolved == null) return "Pays own way";
    const payer = byEmail.get(resolved);
    return `${payer ? firstName(payer) : "They"} pays`;
  }

  const editingPerson = editing ? byEmail.get(editing) : null;
  const editingTraveler = editingListed ? byKey.get(editingListed) : null;
  const nothingShown = shown.length === 0 && shownPast.length === 0;

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
            Who&rsquo;s coming to {tripName} with you?
          </h1>
          <div style={{ font: "400 12.5px var(--font-sans)", color: "var(--text-secondary)", marginTop: 4 }}>
            {past.length
              ? "People on the app get an invite on their Trips screen. Everyone else is just listed."
              : "They’ll get an invite on their Trips screen."}
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
                    const allIn = g.emails.every((email) => chosen[email]) && g.travelerKeys.every((key) => listed[key]);
                    const faces = [...g.emails.map((email) => byEmail.get(email)), ...g.travelerKeys.map((key) => byKey.get(key))];
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
                        <MiniStack people={faces} />
                        {g.name} · {faces.length}
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
              {nothingShown ? (
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
                      <PickRow
                        key={p.email}
                        first={i === 0}
                        checked={Boolean(pick)}
                        onToggle={() => toggle(p)}
                        avatar={<Avatar person={p} size={34} />}
                        name={p.display_name}
                        sub={sharedTripsLine(p)}
                      >
                        {pick ? (
                          <PickChip
                            onClick={() => setEditing(p.email)}
                            label={`${p.display_name}'s role: ${roleLabel(pick.role)}${pick.traveling ? "" : ", not coming"}. Change`}
                          >
                            {roleLabel(pick.role)}
                            {pick.traveling ? "" : " · planning"}
                          </PickChip>
                        ) : null}
                      </PickRow>
                    );
                  })}
                  {shownPast.map((t, i) => {
                    const pick = listed[t.key];
                    return (
                      <PickRow
                        key={t.key}
                        first={shown.length === 0 && i === 0}
                        checked={Boolean(pick)}
                        onToggle={() => toggleListed(t)}
                        avatar={<GhostAvatar initial={t.initial} />}
                        name={t.name}
                        tag="Not on app"
                        sub={pastTravelerLine(t)}
                      >
                        {pick ? (
                          <PickChip
                            plain
                            onClick={() => setEditingListed(t.key)}
                            label={`Who pays for ${t.name}: ${payerLabel(pick.paidBy)}. Change`}
                          >
                            {payerLabel(pick.paidBy)}
                          </PickChip>
                        ) : null}
                      </PickRow>
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
            {footerLine(invites, listedCount)}
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

      {editingTraveler && listed[editingListed] ? (
        <PayerSheet
          traveler={editingTraveler}
          tripName={tripName}
          paidBy={resolvePayer(listed[editingListed].paidBy, chosen)}
          payers={Object.entries(chosen)
            .filter(([, pick]) => pick.traveling)
            .map(([email]) => byEmail.get(email))
            .filter(Boolean)}
          onChange={(paidBy) => onListedChange({ ...listed, [editingListed]: { paidBy } })}
          onClose={() => setEditingListed(null)}
        />
      ) : null}
    </div>
  );
}

function footerLine(invites, listed) {
  if (invites === 0 && listed === 0) return "No one picked yet";
  const parts = [];
  if (invites) parts.push(`${invites} ${invites === 1 ? "invite" : "invites"}`);
  if (listed) parts.push(`${listed} listed`);
  return parts.join(" · ");
}

function matchesTraveler(traveler, query) {
  const q = query.trim().toLowerCase();
  return !q || traveler.name.toLowerCase().includes(q);
}

// "Taiwan · Mei paid" — where they came, and who paid for them then.
function pastTravelerLine(traveler) {
  const trips = traveler.trips.map((t) => t.name);
  const where = trips.length <= 2 ? trips.join(", ") : `${trips.slice(0, 2).join(", ")} +${trips.length - 2}`;
  if (traveler.paid_by_you) return `${where} · you paid`;
  if (traveler.paid_by_name) return `${where} · ${firstName({ display_name: traveler.paid_by_name })} paid`;
  return where;
}

function PickRow({ first, checked, onToggle, avatar, name, tag, sub, children }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        minHeight: 58,
        borderTop: first ? "none" : "1px solid var(--hairline)",
      }}
    >
      <label style={{ display: "flex", alignItems: "center", gap: 11, flex: 1, minWidth: 0, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          style={{ width: 20, height: 20, accentColor: "var(--accent)", margin: 0, flex: "none" }}
        />
        {avatar}
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, font: "600 14px var(--font-sans)", color: "var(--text-primary)" }}>
            {name}
            {tag ? <NotOnAppTag>{tag}</NotOnAppTag> : null}
          </span>
          <span style={{ display: "block", font: "400 12px var(--font-sans)", color: "var(--text-secondary)", marginTop: 1 }}>
            {sub}
          </span>
        </span>
      </label>
      {children}
    </div>
  );
}

function PickChip({ onClick, label, plain = false, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{
        flex: "none",
        height: 32,
        padding: "0 10px",
        borderRadius: "var(--radius-pill)",
        background: plain ? "var(--surface-sunken)" : "var(--accent-quiet)",
        border: plain ? "1px solid transparent" : "1px solid var(--plum-tint-strong)",
        color: plain ? "var(--stone-700)" : "var(--accent)",
        font: "600 12px var(--font-sans)",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      {children}
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
  );
}

function NotOnAppTag({ children }) {
  return (
    <span
      className="mono-caption"
      style={{ padding: "3px 5px", borderRadius: 4, background: "var(--surface-sunken)", color: "var(--stone-700)", fontSize: 9 }}
    >
      {children}
    </span>
  );
}

// Someone without an account: a dashed outline instead of a colour.
function GhostAvatar({ initial, size = 34 }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: "1.5px dashed var(--text-faint)",
        flex: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        font: "600 11px var(--font-sans)",
        color: "var(--text-muted)",
      }}
    >
      {initial}
    </div>
  );
}

// Who pays for a past traveler on the new trip: you, anyone invited and
// coming, or they pay their own way. Changes apply as they're made.
function PayerSheet({ traveler, tripName, paidBy, payers, onChange, onClose }) {
  const lastTrip = traveler.trips[0]?.name;
  const last = lastPayer(traveler);
  const options = [
    { value: "me", label: "You" },
    ...payers.map((p) => ({ value: p.email, label: p.display_name })),
    { value: null, label: `${traveler.name} pays their own way` },
  ];
  const lastBy = traveler.paid_by_you ? "You" : traveler.paid_by_name;
  return (
    <BottomSheet label={`${traveler.name} on ${tripName}`} onClose={onClose}>
      <div style={{ padding: "8px 16px calc(20px + env(safe-area-inset-bottom, 0px))", overflowY: "auto" }}>
        <div className="serif-place" style={{ fontSize: 22, color: "var(--text-primary)" }}>
          {traveler.name} on {tripName}
        </div>
        {lastTrip ? (
          <div style={{ font: "400 12.5px var(--font-sans)", color: "var(--text-secondary)", marginTop: 2 }}>
            {traveler.name} came on {lastTrip} without an account.
            {lastBy ? ` ${lastBy} paid for ${traveler.name}.` : ""}
          </div>
        ) : null}

        <div className="mono-caption" style={{ marginTop: 14 }}>
          Who pays for {traveler.name}
        </div>
        <div role="radiogroup" aria-label={`Who pays for ${traveler.name}`} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          {options.map((o) => {
            const on = paidBy === o.value;
            return (
              <label
                key={o.value ?? "self"}
                style={{
                  display: "flex",
                  alignItems: "center",
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
                  name="listed-payer"
                  checked={on}
                  onChange={() => onChange(o.value)}
                  style={{ width: 18, height: 18, accentColor: "var(--accent)", margin: 0, flex: "none" }}
                />
                <span style={{ font: "600 14px var(--font-sans)", color: "var(--text-primary)" }}>{o.label}</span>
                {o.value === last && last != null ? (
                  <span
                    className="mono-caption"
                    style={{ padding: "3px 6px", borderRadius: 4, background: "var(--surface-sunken)", color: "var(--stone-700)" }}
                  >
                    Last time
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>
        {last && last !== "me" && !payers.some((p) => p.email === last) ? (
          <div style={{ font: "400 12px var(--font-sans)", color: "var(--text-muted)", marginTop: 10 }}>
            {traveler.paid_by_name ?? "Whoever paid last time"} isn&rsquo;t coming, so you pay unless you pick someone else.
          </div>
        ) : null}
        <div style={{ font: "400 12px var(--font-sans)", color: "var(--text-muted)", marginTop: 10 }}>
          {traveler.name} is listed, not invited. If they get an account later, invite them from Trip settings and they&rsquo;ll
          take over this spot.
        </div>

        <div style={{ marginTop: 18 }}>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
