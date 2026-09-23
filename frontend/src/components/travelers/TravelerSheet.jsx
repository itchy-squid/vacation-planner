import { useState } from "react";
import { usePlannerDispatch, usePlannerState, useCan, useMyTraveler } from "../../state/PlannerContext";
import { copyText, inviteUrl } from "../sharing/links";

// Add or edit one traveler (components/travelers/TravelerRoster.jsx).
// Adding and editing are the same screen with the same fields, so a
// traveler can be changed in exactly the words they were added in; only
// the title, the save button's label and Remove differ.
//
// - Name, and who pays for them: "Themselves", or anyone who pays their
//   own way. One level only (backend routers/travelers.py): someone paid
//   for by another can't pay for others.
// - For someone without an account: just list them, or make an invite
//   link that signs whoever opens it in *as this traveler* — so Grandma
//   Hua joining becomes this row rather than a second Hua.
// - Remove, which takes them off every group and cost split.
export default function TravelerSheet({ traveler, onClose }) {
  const { travelers, contributors, currentUserId } = usePlannerState();
  const dispatch = usePlannerDispatch();
  const can = useCan();
  const me = useMyTraveler();
  const canManage = can("travelers:manage");
  const canInvite = can("members:manage");
  const isNew = traveler == null;

  const [name, setName] = useState(traveler?.name ?? "");
  const [paidById, setPaidById] = useState(traveler?.paidById ?? null);
  // "list" (no account), "invite" (a link that signs them in as this
  // traveler) or "member" (they're already on the app: link them).
  const [onApp, setOnApp] = useState(
    traveler?.contributorId != null ? "member" : traveler?.invited ? "invite" : "list"
  );
  const [memberId, setMemberId] = useState(traveler?.contributorId ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [removeArmed, setRemoveArmed] = useState(false);

  // Who can pay: anyone paying their own way, other than this traveler.
  // Someone who already pays for others can't be paid for, so for them the
  // only choice is themselves.
  const paysForOthers = traveler ? travelers.some((t) => t.paidById === traveler.id) : false;
  const payers = paysForOthers ? [] : travelers.filter((t) => t.paidById == null && t.id !== traveler?.id);

  // Members who could be this traveler: anyone on the app not already
  // listed as someone else.
  const linkable = contributors.filter(
    (c) => c.id === traveler?.contributorId || !travelers.some((t) => t.contributorId === c.id)
  );
  // Who is on the app is a planner's call; editing yourself doesn't
  // include unlinking your own account.
  const canChangeApp = canManage && !(traveler?.contributorId != null && traveler.contributorId === currentUserId);

  async function makeInvite(travelerId) {
    const result = await dispatch({ type: "INVITE_TRAVELER", id: travelerId, role: "companion" });
    if (!result.ok) throw new Error(result.error || "Couldn't make the link.");
    const url = inviteUrl(result.invite.token);
    setLink(url);
    setCopied(await copyText(url));
  }

  async function save(e) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const linkTo = canChangeApp && onApp === "member" ? memberId : null;
      if (canChangeApp && onApp === "member" && linkTo == null) throw new Error("Pick who they are on the app.");
      let id = traveler?.id;
      if (isNew) {
        const payload = { name: name.trim(), paid_by_id: paidById };
        if (linkTo != null) payload.contributor_id = linkTo;
        const result = await dispatch({ type: "CREATE_TRAVELER", payload });
        if (!result.ok) throw new Error(result.error);
        id = result.traveler.id;
      } else {
        const fields = {};
        if (name.trim() !== traveler.name) fields.name = name.trim();
        if (paidById !== traveler.paidById) fields.paid_by_id = paidById;
        // "Just list them" / "Invite" on someone linked to an account
        // unlinks it (the account stays on the trip); "already a member"
        // links the one picked.
        if (canChangeApp && (linkTo ?? null) !== (traveler.contributorId ?? null)) fields.contributor_id = linkTo;
        if (Object.keys(fields).length) {
          const result = await dispatch({ type: "PATCH_TRAVELER", id: traveler.id, fields });
          if (!result.ok) throw new Error(result.error);
        }
      }
      if (canChangeApp && onApp === "invite" && canInvite) {
        await makeInvite(id);
        setBusy(false);
        return; // stay open to show the link
      }
      onClose();
    } catch (err) {
      setError(err.message || "Couldn't save that.");
      setBusy(false);
    }
  }

  async function remove() {
    if (!removeArmed) {
      setRemoveArmed(true);
      return;
    }
    setBusy(true);
    const result = await dispatch({ type: "DELETE_TRAVELER", id: traveler.id });
    if (result.ok) onClose();
    else {
      setError(result.error || "Couldn't remove them.");
      setBusy(false);
      setRemoveArmed(false);
    }
  }

  const who = name.trim() || "them";
  const isMe = me?.id === traveler?.id;

  return (
    <div
      style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "flex-end", zIndex: 60 }}
      onClick={onClose}
    >
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--surface-card)", borderRadius: "20px 20px 0 0", padding: "10px 18px 28px", width: "100%", maxHeight: "88vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}
      >
        <div style={{ width: 38, height: 4, borderRadius: 99, background: "var(--stone-250)", margin: "0 auto 2px" }} />
        <div className="serif-place" style={{ fontSize: 19, color: "var(--text-primary)" }}>
          {isNew ? "Add a traveler" : "Edit traveler"}
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="mono-caption">Name</span>
          <input
            id="traveler-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Grandma Hua"
            autoFocus={isNew}
            style={fieldStyle}
          />
        </label>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="mono-caption">Paid for by</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <Chip on={paidById == null} onClick={() => setPaidById(null)}>
              {isMe ? "Myself" : "Themselves"}
            </Chip>
            {payers.map((p) => (
              <Chip key={p.id} on={paidById === p.id} onClick={() => setPaidById(p.id)}>
                {p.name}
              </Chip>
            ))}
          </div>
          <span style={{ font: "400 11.5px var(--font-sans)", color: "var(--text-muted)" }}>
            {paysForOthers
              ? `${traveler.name} pays for others, so pays their own way too.`
              : paidById == null
              ? isMe
                ? "You pay your own share."
                : `${who === "them" ? "They pay" : `${who} pays`} their own share.`
              : `Their share of every cost counts in what ${travelers.find((t) => t.id === paidById)?.name} pays.`}
          </span>
        </div>

        {canChangeApp && !link && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="mono-caption">On the app?</span>
            <Radio
              on={onApp === "list"}
              onClick={() => setOnApp("list")}
              title={isNew ? "Just list them" : "Not on the app"}
              sub={
                !isNew && traveler.contributorId != null
                  ? "Unlinks their account from this traveler. The account stays on the trip."
                  : "Counted on groups and costs. No login needed."
              }
            />
            {canInvite && (
              <Radio
                on={onApp === "invite"}
                onClick={() => setOnApp("invite")}
                title={!isNew && traveler.invited ? "Invited — get their link again" : "Invite them as a companion"}
                sub="You get a link that signs them in as this traveler, so nothing is duplicated."
              />
            )}
            {linkable.length > 0 && (
              <Radio
                on={onApp === "member"}
                onClick={() => setOnApp("member")}
                title="They're already on the app"
                sub="Link this traveler to someone on the People list."
              />
            )}
            {onApp === "member" && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingLeft: 4 }}>
                {linkable.map((c) => (
                  <Chip key={c.id} on={memberId === c.id} onClick={() => setMemberId(c.id)}>
                    {c.name}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        )}
        {!canChangeApp && !isNew && (
          <div style={{ font: "400 12px var(--font-sans)", color: "var(--text-secondary)" }}>
            {traveler.contributorId != null
              ? `On the app as ${isMe ? "you" : contributors.find((c) => c.id === traveler.contributorId)?.name ?? "a member"}.`
              : "Not on the app."}
          </div>
        )}

        {link && (
          <div style={{ padding: "10px 12px", borderRadius: "var(--radius-lg)", background: "var(--plum-tint)", display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ font: "600 12px var(--font-sans)", color: "var(--accent)" }}>
              {copied ? "Link copied. Send it to them." : "Send them this link:"}
            </span>
            <span className="mono-data-sm" style={{ color: "var(--text-primary)", wordBreak: "break-all", userSelect: "all" }}>{link}</span>
          </div>
        )}

        {error ? <div style={{ font: "500 12.5px var(--font-sans)", color: "#b3423a" }}>{error}</div> : null}

        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={onClose} style={{ ...secondaryButton, flex: 1 }}>
            {link ? "Done" : "Cancel"}
          </button>
          {!link && (
            <button
              type="submit"
              disabled={busy || !name.trim()}
              style={{ flex: 1, height: 44, borderRadius: "var(--radius-lg)", background: "var(--surface-inverse)", color: "#fff", font: "600 13px var(--font-sans)", opacity: busy || !name.trim() ? 0.5 : 1 }}
            >
              {busy ? "Saving…" : isNew ? "Add" : "Save"}
            </button>
          )}
        </div>

        {!isNew && canManage && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button
              type="button"
              onClick={remove}
              onBlur={() => setRemoveArmed(false)}
              disabled={busy}
              style={{
                height: 44,
                borderRadius: "var(--radius-lg)",
                background: removeArmed ? "var(--danger, #b3261e)" : "var(--surface-page)",
                border: removeArmed ? "none" : "1px solid var(--border-strong)",
                color: removeArmed ? "#fff" : "var(--danger, #b3261e)",
                font: "600 13px var(--font-sans)",
              }}
            >
              {removeArmed ? "Tap again to remove" : "Remove from the trip"}
            </button>
            <span style={{ textAlign: "center", font: "400 11px var(--font-sans)", color: "var(--text-muted)" }}>
              Takes {traveler.name} off every group and cost split.
              {traveler.contributorId != null ? " Their account stays on the trip." : ""}
            </span>
          </div>
        )}
      </form>
    </div>
  );
}

function Chip({ on, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      style={{
        padding: "6px 11px",
        borderRadius: 999,
        border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
        background: on ? "var(--plum-tint)" : "var(--surface-card)",
        color: on ? "var(--accent)" : "var(--text-primary)",
        font: `${on ? 600 : 500} 12px var(--font-sans)`,
      }}
    >
      {children}
    </button>
  );
}

function Radio({ on, onClick, title, sub }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        textAlign: "left",
        padding: "9px 11px",
        borderRadius: "var(--radius-lg)",
        border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
        background: on ? "var(--plum-tint)" : "var(--surface-card)",
      }}
    >
      <span
        aria-hidden="true"
        style={{ width: 14, height: 14, marginTop: 2, borderRadius: "50%", flex: "none", border: on ? "4.5px solid var(--accent)" : "1.5px solid var(--border-strong)" }}
      />
      <span>
        <span style={{ display: "block", font: "600 12.5px var(--font-sans)", color: "var(--text-primary)" }}>{title}</span>
        <span style={{ font: "400 11px var(--font-sans)", color: "var(--text-secondary)" }}>{sub}</span>
      </span>
    </button>
  );
}

const fieldStyle = {
  height: 44,
  padding: "0 12px",
  borderRadius: "var(--radius-lg)",
  border: "1px solid var(--border-strong)",
  background: "var(--surface-page)",
  font: "500 14px var(--font-sans)",
  color: "var(--text-primary)",
};

const secondaryButton = {
  height: 44,
  padding: "0 14px",
  borderRadius: "var(--radius-lg)",
  background: "var(--surface-page)",
  border: "1px solid var(--border-strong)",
  color: "var(--text-primary)",
  font: "600 13px var(--font-sans)",
};
