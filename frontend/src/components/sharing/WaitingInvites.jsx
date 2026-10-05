import { useEffect, useState } from "react";
import Button from "../core/Button";
import { Avatar } from "./PeopleList";
import { api } from "../../lib/api";
import { ROLES, roleLabel } from "../../lib/roles";
import { formatTripWhen } from "../../lib/format";
import { usePlannerDispatch } from "../../state/PlannerContext";

// Invites sent straight to you — someone you've planned with picked you on
// a new trip's "Who's planning with you?" step (pages/NewTrip.jsx). They
// wait here at the top of Trips home until you join or decline; there's
// no link to open. Joining is the same accept a link uses
// (PlannerContext's JOIN_TRIP), so the trip opens as the primary card and
// `onJoined` shows the "added" toast. Renders nothing when none are
// waiting.
export default function WaitingInvites({ onJoined }) {
  const [invites, setInvites] = useState([]);

  useEffect(() => {
    let cancelled = false;
    api
      .myInvites()
      .then((rows) => {
        if (!cancelled) setInvites(rows);
      })
      .catch((err) => console.error("couldn't load invites", err));
    return () => {
      cancelled = true;
    };
  }, []);

  if (invites.length === 0) return null;

  const drop = (id) => setInvites((prev) => prev.filter((i) => i.id !== id));

  return (
    <>
      <div className="mono-caption" style={{ padding: "0 var(--gutter-text) 10px" }}>
        {invites.length === 1 ? "Invitation" : `Invitations · ${invites.length}`}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "0 var(--gutter-screen) 20px" }}>
        {invites.map((invite) => (
          <InviteCard
            key={invite.id}
            invite={invite}
            onDone={(joined) => {
              drop(invite.id);
              if (joined) onJoined?.(invite.trip_name);
            }}
          />
        ))}
      </div>
    </>
  );
}

function InviteCard({ invite, onDone }) {
  const dispatch = usePlannerDispatch();
  const [busy, setBusy] = useState(null); // null | "join" | "decline"
  const [error, setError] = useState("");
  const sender = invite.invited_by;
  const points = (ROLES[invite.role]?.joinPoints ?? []).filter(([yes]) => yes).slice(0, 2);
  const others = invite.member_count - 1;

  async function join() {
    if (busy) return;
    setBusy("join");
    setError("");
    const result = await dispatch({ type: "JOIN_TRIP", token: invite.token, claim: {} });
    if (result.ok) {
      onDone(true);
      return;
    }
    setBusy(null);
    if (result.gone) onDone(false);
    else setError(result.error || "Couldn't join. Try again.");
  }

  async function decline() {
    if (busy) return;
    setBusy("decline");
    setError("");
    try {
      await api.declineInvite(invite.token);
      onDone(false);
    } catch (err) {
      setBusy(null);
      if (err.status === 404) onDone(false);
      else setError(err.message || "Couldn't decline. Try again.");
    }
  }

  return (
    <div
      style={{
        background: "var(--surface-card)",
        borderRadius: "var(--radius-2xl)",
        border: "1.5px solid var(--accent)",
        boxShadow: "var(--shadow-raised)",
        padding: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Avatar person={sender} size={28} />
        <div style={{ font: "400 12.5px var(--font-sans)", color: "var(--text-secondary)" }}>
          <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{sender?.display_name ?? "Someone"}</span> invited
          you to plan
        </div>
      </div>
      <div className="serif-place" style={{ fontSize: 26, lineHeight: 1.15, color: "var(--text-primary)", marginTop: 8 }}>
        {invite.trip_name}
      </div>
      <div style={{ font: "400 12.5px var(--font-sans)", color: "var(--text-secondary)", marginTop: 2 }}>
        {formatTripWhen(invite)}
        {others > 0 ? ` · ${others} other${others === 1 ? "" : "s"} on it` : ""}
      </div>

      <div
        style={{
          background: "var(--surface-inset)",
          borderRadius: "var(--radius-md)",
          padding: "10px 12px",
          marginTop: 12,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ font: "600 12.5px var(--font-sans)", color: "var(--text-primary)" }}>
          You&rsquo;d join as a {roleLabel(invite.role).toLowerCase()}
          {invite.traveling ? ", and as a traveler" : ", to help plan"}
        </div>
        {points.map(([, text]) => (
          <div key={text} style={{ display: "flex", gap: 6, font: "400 12.5px var(--font-sans)", color: "var(--stone-700)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--geo)" strokeWidth="2.5" aria-hidden="true" style={{ flex: "none", marginTop: 2 }}>
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            {text}
          </div>
        ))}
      </div>

      {error ? (
        <div role="alert" style={{ font: "500 12.5px var(--font-sans)", color: "var(--warn)", marginTop: 10 }}>
          {error}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <Button variant="accent" onClick={join} disabled={busy !== null}>
          {busy === "join" ? "Joining…" : `Join ${invite.trip_name}`}
        </Button>
        <Button variant="secondary" onClick={decline} disabled={busy !== null}>
          {busy === "decline" ? "Declining…" : "Decline"}
        </Button>
      </div>
    </div>
  );
}
