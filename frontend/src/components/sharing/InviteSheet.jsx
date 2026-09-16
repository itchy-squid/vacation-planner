import { useEffect, useState } from "react";
import Button from "../core/Button";
import { api } from "../../lib/api";
import { CopyIcon, ShareIcon } from "./icons";
import { copyText, inviteUrl } from "./links";
import { GRANTABLE_ROLES, ROLES } from "../../lib/roles";

// Least access first, so the safest link is the one at the top.
const OPTIONS = [...GRANTABLE_ROLES].reverse().map((role) => ({
  role,
  title: ROLES[role].label,
  body: ROLES[role].invite,
}));

// The owner's "Invite people" sheet: pick a role, get that role's link.
// There's one live link per role (backend/app/routers/sharing.py), so
// switching the role shows the other link rather than minting a new one
// each time. `onLinksChanged` lets Trip settings refresh its link list
// when this sheet creates one.
export default function InviteSheet({ trip, onClose, onLinksChanged }) {
  const [role, setRole] = useState("planner");
  const [links, setLinks] = useState({}); // role -> invite
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const invite = links[role];

  useEffect(() => {
    if (links[role]) return undefined;
    let cancelled = false;
    setError("");
    api
      .getInvite(trip.id, role)
      .then((created) => {
        if (cancelled) return;
        setLinks((prev) => ({ ...prev, [role]: created }));
        onLinksChanged?.();
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Couldn't make a link. Try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [role, links, trip.id, onLinksChanged]);

  useEffect(() => setCopied(false), [role]);

  async function handleCopy() {
    if (!invite) return;
    setCopied(await copyText(inviteUrl(invite.token)));
  }

  async function handleShare() {
    if (!invite) return;
    const url = inviteUrl(invite.token);
    if (window.navigator.share) {
      try {
        await window.navigator.share({ title: trip.name, text: `Join ${trip.name} on the trip planner`, url });
        return;
      } catch (err) {
        if (err?.name === "AbortError") return;
      }
    }
    setCopied(await copyText(url));
  }

  return (
    <div
      style={{ position: "absolute", inset: 0, background: "rgba(27,26,31,.32)", display: "flex", alignItems: "flex-end", zIndex: 1000 }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Invite to ${trip.name}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          background: "var(--surface-card)",
          borderRadius: "20px 20px 0 0",
          boxShadow: "var(--shadow-sheet)",
          padding: "10px 16px 30px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ width: 38, height: 4, borderRadius: 99, background: "var(--stone-250)", alignSelf: "center" }} />
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "4px 4px 0" }}>
          <div>
            <div className="serif-place" style={{ font: "var(--type-heading)", color: "var(--text-primary)" }}>
              Invite to {trip.name}
            </div>
            <div style={{ font: "var(--type-body)", color: "var(--text-secondary)", marginTop: 4 }}>
              Anyone who opens this link and signs in can add {trip.name} to their trips.
            </div>
          </div>
          <button
            type="button"
            className="hit-target"
            onClick={onClose}
            style={{ height: 44, font: "500 13px var(--font-sans)", color: "var(--accent)", flex: "none" }}
          >
            Done
          </button>
        </div>

        <div className="mono-caption" style={{ padding: "0 4px" }}>They join as</div>
        <div role="radiogroup" aria-label="Role" style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: -6 }}>
          {OPTIONS.map((o) => {
            const selected = o.role === role;
            return (
              <button
                key={o.role}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setRole(o.role)}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                  textAlign: "left",
                  padding: "13px 14px",
                  borderRadius: "var(--radius-lg)",
                  border: selected ? "1.5px solid var(--surface-inverse)" : "1px solid var(--border)",
                  background: "var(--surface-card)",
                  transition: "var(--transition-select)",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    flex: "none",
                    marginTop: 1,
                    background: selected ? "var(--surface-inverse)" : "transparent",
                    border: selected ? "none" : "1.5px solid var(--border-strong)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {selected ? <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} /> : null}
                </span>
                <span style={{ flex: 1 }}>
                  <span style={{ display: "block", font: "var(--type-label)", color: "var(--text-primary)" }}>{o.title}</span>
                  <span style={{ display: "block", font: "var(--type-body-sm)", color: "var(--text-secondary)", marginTop: 2 }}>{o.body}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="mono-caption" style={{ padding: "0 4px" }}>{ROLES[role].label} link</div>
        <div
          style={{
            marginTop: -6,
            display: "flex",
            alignItems: "center",
            gap: 8,
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-lg)",
            padding: "4px 4px 4px 13px",
            background: "var(--surface-inset)",
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: 0,
              font: "400 12.5px var(--font-mono)",
              color: "var(--text-secondary)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              userSelect: "all",
            }}
          >
            {invite ? inviteUrl(invite.token) : error ? "—" : "Making a link…"}
          </div>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!invite}
            style={{
              height: 38,
              padding: "0 12px",
              borderRadius: "var(--radius-md)",
              background: "var(--surface-card)",
              border: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              gap: 6,
              font: "600 12.5px var(--font-sans)",
              color: "var(--text-primary)",
              opacity: invite ? 1 : 0.45,
              flex: "none",
            }}
          >
            <CopyIcon />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        {error ? <div style={{ font: "500 12.5px var(--font-sans)", color: "#b3423a", padding: "0 4px" }}>{error}</div> : null}

        <Button onClick={handleShare} disabled={!invite} style={{ marginTop: 4 }}>
          <ShareIcon />
          Share link
        </Button>
        <div style={{ font: "var(--type-caption)", color: "var(--text-muted)", textAlign: "center", padding: "0 12px" }}>
          Each role has its own link. Links keep working until you revoke them in Trip settings.
        </div>
      </div>
    </div>
  );
}
