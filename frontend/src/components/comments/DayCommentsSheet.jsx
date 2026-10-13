import { useEffect, useRef, useState } from "react";
import BottomSheet from "../core/BottomSheet";
import CommentMark from "./CommentMark";
import { relativeTime } from "../../lib/format";

// How long "Delete" stays armed for its second tap.
const DELETE_CONFIRM_MS = 3000;

// One day's comments, oldest first, and a box to add one: opened from the
// day's comment chip on the Plan tab and from a day on the Itinerary.
// Everyone on the trip reads them; anyone with comments:write writes them;
// only the person who wrote a comment can change or delete it, which the
// server checks too (backend/app/routers/comments.py).
export default function DayCommentsSheet({ day, label, comments, contributors, currentUserId, canComment, onAdd, onEdit, onDelete, onClose }) {
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const listRef = useRef(null);
  const byId = Object.fromEntries(contributors.map((c) => [c.id, c]));

  // Land on the newest comment, which is where a conversation is read from.
  const count = comments.length;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  const post = async () => {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    setError(null);
    try {
      await onAdd(day, body);
      setDraft("");
    } catch (e) {
      setError(reason(e) || "Your comment didn’t post. Try again.");
    } finally {
      setPosting(false);
    }
  };

  return (
    <BottomSheet label={`Comments on ${label}`} onClose={onClose}>
      <div style={{ padding: "6px var(--gutter-screen) 10px", borderBottom: "1px solid var(--hairline)", flex: "none" }}>
        <div className="serif-place" style={{ fontSize: 20, color: "var(--text-primary)" }}>{label}</div>
        <div style={{ font: "400 12px var(--font-sans)", color: "var(--text-secondary)", marginTop: 2 }}>Comments on the whole day. Everyone on the trip can see them.</div>
      </div>

      <div ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px var(--gutter-screen)" }}>
        {comments.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "18px 0", font: "400 13px var(--font-sans)", color: "var(--text-muted)" }}>
            <CommentMark size={14} filled={false} />
            {canComment ? "No comments on this day yet. Start one below." : "No comments on this day yet."}
          </div>
        ) : (
          comments.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              author={byId[c.who]}
              mine={c.who === currentUserId && canComment}
              editing={editingId === c.id}
              onStartEdit={() => setEditingId(c.id)}
              onStopEdit={() => setEditingId(null)}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))
        )}
      </div>

      {canComment ? (
        <div style={{ flex: "none", borderTop: "1px solid var(--hairline)", padding: "10px var(--gutter-screen) calc(12px + env(safe-area-inset-bottom, 0px))" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <textarea
              id={`day-comment-${day}`}
              aria-label={`Comment on ${label}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post();
              }}
              placeholder="Ferry’s at 7:40, bring cash for the boat…"
              rows={2}
              style={{
                flex: 1,
                minWidth: 0,
                resize: "none",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                background: "var(--surface-inset)",
                padding: "8px 10px",
                font: "400 16px/1.4 var(--font-sans)",
                color: "var(--text-primary)",
              }}
            />
            <button
              type="button"
              onClick={post}
              disabled={!draft.trim() || posting}
              style={{
                flex: "none",
                height: 40,
                padding: "0 14px",
                borderRadius: "var(--radius-md)",
                background: "var(--accent)",
                color: "var(--text-on-accent)",
                font: "600 13px var(--font-sans)",
                opacity: !draft.trim() || posting ? 0.4 : 1,
              }}
            >
              {posting ? "Posting…" : "Post"}
            </button>
          </div>
          {error ? <div role="alert" style={{ marginTop: 6, font: "500 12px var(--font-sans)", color: "var(--warn)" }}>{error}</div> : null}
        </div>
      ) : null}
      {/* Both screens that open this have the tab bar fixed over the
          bottom of the screen (components/core/BottomNav.jsx). */}
      <div aria-hidden="true" style={{ height: "var(--bottom-nav-height)", flex: "none" }} />
    </BottomSheet>
  );
}

function CommentRow({ comment, author, mine, editing, onStartEdit, onStopEdit, onEdit, onDelete }) {
  const [text, setText] = useState(comment.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), DELETE_CONFIRM_MS);
    return () => clearTimeout(t);
  }, [armed]);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(reason(e) || "That didn’t work. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const body = text.trim();
    if (!body) return;
    if (body === comment.body) return onStopEdit();
    if (await run(() => onEdit(comment.id, body))) onStopEdit();
  };

  const remove = () => {
    if (!armed) return setArmed(true);
    run(() => onDelete(comment.id));
  };

  const name = mine ? "You" : author?.name ?? "Someone who left";
  return (
    <div style={{ display: "flex", gap: 10, padding: "10px 0", borderTop: "1px solid var(--hairline)" }}>
      <span
        aria-hidden="true"
        style={{
          width: 26,
          height: 26,
          flex: "none",
          borderRadius: "50%",
          background: author?.tint ?? "var(--who-more)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          font: "600 11px var(--font-sans)",
          color: "var(--text-primary)",
        }}
      >
        {author?.initial ?? "?"}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ font: "600 13px var(--font-sans)", color: "var(--text-primary)" }}>{name}</span>
          <span style={{ font: "400 11px var(--font-sans)", color: "var(--text-muted)" }}>
            {relativeTime(comment.createdAt)}
            {comment.editedAt ? " · edited" : ""}
          </span>
        </div>
        {editing ? (
          <>
            <textarea
              id={`edit-comment-${comment.id}`}
              aria-label="Edit your comment"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              autoFocus
              style={{
                width: "100%",
                marginTop: 4,
                resize: "none",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                background: "var(--surface-inset)",
                padding: "8px 10px",
                font: "400 16px/1.4 var(--font-sans)",
                color: "var(--text-primary)",
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
              <button type="button" onClick={save} disabled={busy || !text.trim()} style={linkStyle("var(--accent)")}>
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setText(comment.body);
                  onStopEdit();
                }}
                style={linkStyle("var(--text-secondary)")}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ font: "400 13.5px/1.45 var(--font-sans)", color: "var(--text-primary)", marginTop: 2, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{comment.body}</div>
            {mine ? (
              <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
                <button type="button" onClick={onStartEdit} disabled={busy} style={linkStyle("var(--text-secondary)")}>
                  Edit
                </button>
                <button type="button" onClick={remove} disabled={busy} style={linkStyle(armed ? "var(--warn)" : "var(--text-secondary)")}>
                  {armed ? "Tap again to delete" : "Delete"}
                </button>
              </div>
            ) : null}
          </>
        )}
        {error ? <div role="alert" style={{ marginTop: 4, font: "500 12px var(--font-sans)", color: "var(--warn)" }}>{error}</div> : null}
      </div>
    </div>
  );
}

// The server's own sentence for a refusal ("Write something first"), not
// the request line api.js puts in front of it.
function reason(e) {
  return typeof e?.body?.detail === "string" ? e.body.detail : null;
}

function linkStyle(color) {
  return { padding: 0, font: "600 12px var(--font-sans)", color };
}
