import Button from "../core/Button";
import BottomSheet from "../core/BottomSheet";
import { GRANTABLE_ROLES, ROLES, roleLabel } from "../../lib/roles";
import { firstName } from "../../lib/people";

// Pieces shared by the two places you pick people you've planned with:
// a new trip's "Who's coming with you?" step (components/newtrip/
// WhoIsPlanning.jsx) and an existing trip's Invite sheet
// (components/sharing/InvitePeopleTab.jsx).

// A trip's faces in a group chip. Someone without an account (a past
// traveler, keyed rather than emailed) gets a dashed outline.
export function MiniStack({ people }) {
  const shown = people.filter(Boolean).slice(0, 3);
  return (
    <span style={{ display: "flex" }} aria-hidden="true">
      {shown.map((p, i) => (
        <span
          key={p.email ?? p.key}
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: p.email ? p.tint : "var(--surface-card)",
            border: p.email ? "2px solid var(--surface-card)" : "1.5px dashed var(--text-faint)",
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

// One person's role on a trip they're being invited to, and whether
// they're coming. Changes apply as they're made; Done just closes.
// `swapName` is the listed traveler they'll take over if they're coming
// (an existing trip's Invite sheet), rather than being added as a new one.
export function RoleSheet({ person, tripName, pick, swapName, onChange, onClose }) {
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
              {swapName
                ? `Takes over ${swapName}, already listed, with their groups, costs and who pays.`
                : "Lists them as a traveler, so shared costs include them."}{" "}
              Turn off for someone who&rsquo;s only helping plan.
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
