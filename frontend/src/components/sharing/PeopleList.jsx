import { useState } from "react";
import RoleTag from "../core/RoleTag";
import { CaretIcon } from "./icons";
import { roleLabel, usePlannerDispatch } from "../../state/PlannerContext";

// Everyone on the trip, one row each. With `editable` (the owner's Trip
// settings), each non-owner row carries a role picker that can also
// remove the person, behind an inline confirmation. Without it (everyone
// else's Trip info), the role is plain text.
export default function PeopleList({ contributors, currentUserId, editable = false }) {
  return (
    <div
      style={{
        background: "var(--surface-card)",
        borderRadius: "var(--radius-xl)",
        border: "1px solid var(--hairline)",
        overflow: "hidden",
      }}
    >
      {contributors.map((c, i) => (
        <PersonRow
          key={c.id}
          person={c}
          isYou={c.id === currentUserId}
          editable={editable}
          last={i === contributors.length - 1}
        />
      ))}
    </div>
  );
}

export function Avatar({ person, size = 30 }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: person?.tint ?? "var(--who-1)",
        flex: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        font: "600 10px var(--font-sans)",
        color: "var(--text-secondary)",
      }}
    >
      {person?.initial ?? "?"}
    </div>
  );
}

function PersonRow({ person, isYou, editable, last }) {
  const dispatch = usePlannerDispatch();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action) {
    setBusy(true);
    setError("");
    const result = await dispatch(action);
    // A successful removal unmounts this row; only a failure needs state.
    if (!result?.ok) {
      setBusy(false);
      setError(result?.error || "Couldn't save that. Try again.");
    } else {
      setBusy(false);
      setConfirmingRemove(false);
    }
  }

  function onPick(e) {
    const value = e.target.value;
    if (value === "remove") {
      setConfirmingRemove(true);
      return;
    }
    if (value !== person.role) run({ type: "CHANGE_ROLE", contributorId: person.id, role: value });
  }

  const name = isYou ? `${person.name} (you)` : person.name;
  const canEdit = editable && person.role !== "owner";

  return (
    <div style={{ borderBottom: last ? "none" : "1px solid var(--hairline)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, minHeight: 56, padding: "6px 14px" }}>
        <Avatar person={person} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: "var(--type-label)", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {name}
          </div>
          <div style={{ font: "var(--type-body-sm)", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {person.email}
          </div>
        </div>
        {person.role === "owner" ? (
          <RoleTag role="owner" />
        ) : canEdit ? (
          // A native select under a pill-shaped face: the platform picker
          // on phones, keyboard access for free.
          <label
            style={{
              position: "relative",
              height: 30,
              padding: "0 10px 0 11px",
              borderRadius: "var(--radius-pill)",
              border: "1px solid var(--border)",
              background: "var(--surface-card)",
              display: "flex",
              alignItems: "center",
              gap: 6,
              font: "500 12px var(--font-sans)",
              color: "var(--text-primary)",
              opacity: busy ? 0.5 : 1,
              flex: "none",
            }}
          >
            {roleLabel(person.role)}
            <span style={{ color: "var(--text-secondary)", display: "flex" }}>
              <CaretIcon />
            </span>
            <select
              aria-label={`Role for ${person.name}`}
              value={person.role}
              onChange={onPick}
              disabled={busy}
              style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%" }}
            >
              <option value="contributor">Contributor</option>
              <option value="reader">Reader</option>
              <option value="remove">Remove from trip…</option>
            </select>
          </label>
        ) : (
          <span style={{ font: "var(--type-body-sm)", color: "var(--text-muted)", flex: "none" }}>{roleLabel(person.role)}</span>
        )}
      </div>

      {confirmingRemove ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 14px 12px 55px" }}>
          <span style={{ flex: 1, font: "var(--type-body-sm)", color: "var(--text-secondary)" }}>
            Remove {person.name}? Their votes, comments and drafts go with them.
          </span>
          <button
            type="button"
            className="hit-target"
            disabled={busy}
            onClick={() => setConfirmingRemove(false)}
            style={{ height: 44, padding: "0 6px", font: "600 12.5px var(--font-sans)", color: "var(--text-secondary)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="hit-target"
            disabled={busy}
            onClick={() => run({ type: "REMOVE_MEMBER", contributorId: person.id })}
            style={{ height: 44, padding: "0 6px", font: "600 12.5px var(--font-sans)", color: "var(--warn)" }}
          >
            {busy ? "Removing…" : "Remove"}
          </button>
        </div>
      ) : null}
      {error ? (
        <div style={{ padding: "0 14px 12px 55px", font: "500 12px var(--font-sans)", color: "#b3423a" }}>{error}</div>
      ) : null}
    </div>
  );
}
