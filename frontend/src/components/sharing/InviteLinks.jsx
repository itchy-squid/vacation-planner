import { useState } from "react";
import { api } from "../../lib/api";
import { roleLabel } from "../../state/PlannerContext";
import { LinkIcon } from "./icons";
import { copyText, inviteUrl } from "./links";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// The owner's live invite links, each with Copy and Revoke. Revoking stops
// the link working; people who already joined through it stay.
export default function InviteLinks({ tripId, invites, onChanged }) {
  if (!invites.length) return null;
  return (
    <div
      style={{
        background: "var(--surface-card)",
        borderRadius: "var(--radius-xl)",
        border: "1px solid var(--hairline)",
        overflow: "hidden",
      }}
    >
      {invites.map((invite, i) => (
        <LinkRow key={invite.id} tripId={tripId} invite={invite} last={i === invites.length - 1} onChanged={onChanged} />
      ))}
    </div>
  );
}

function LinkRow({ tripId, invite, last, onChanged }) {
  const [copied, setCopied] = useState(false);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleRevoke() {
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.revokeInvite(tripId, invite.id);
      onChanged();
    } catch (err) {
      setError(err.message || "Couldn't revoke that link.");
      setBusy(false);
      setArmed(false);
    }
  }

  const actionStyle = { height: 44, display: "flex", alignItems: "center", padding: "0 4px", font: "600 12.5px var(--font-sans)" };

  return (
    <div style={{ borderBottom: last ? "none" : "1px solid var(--hairline)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, minHeight: 58, padding: "4px 12px 4px 14px" }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            background: "var(--surface-page)",
            color: "var(--text-secondary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
          }}
        >
          <LinkIcon />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: "var(--type-label)", color: "var(--text-primary)" }}>{roleLabel(invite.role)} link</div>
          <div className="mono-caption" style={{ marginTop: 3 }}>
            Created {shortDate(invite.created_at)} · {invite.joined_count} joined
          </div>
        </div>
        <button
          type="button"
          className="hit-target"
          onClick={async () => setCopied(await copyText(inviteUrl(invite.token)))}
          style={{ ...actionStyle, color: "var(--accent)" }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          className="hit-target"
          onClick={handleRevoke}
          onBlur={() => !busy && setArmed(false)}
          disabled={busy}
          style={{ ...actionStyle, color: "var(--warn)", paddingLeft: 8 }}
        >
          {busy ? "Revoking…" : armed ? "Confirm?" : "Revoke"}
        </button>
      </div>
      {error ? <div style={{ padding: "0 14px 12px 55px", font: "500 12px var(--font-sans)", color: "#b3423a" }}>{error}</div> : null}
    </div>
  );
}
