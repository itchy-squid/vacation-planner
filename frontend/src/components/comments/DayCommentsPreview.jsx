import CommentMark from "./CommentMark";

// How many of a day's comments the Itinerary shows before "See all".
const SHOWN = 2;

// A day's comments on the Itinerary: the latest two, each a line in the
// comment colour with who said it, then a link to the rest and to adding
// one. Any of it opens the day's comments (DayCommentsSheet.jsx). A day
// with none shows only the link, and only to someone who can comment.
export default function DayCommentsPreview({ comments, contributors, currentUserId, canComment, onOpen }) {
  if (!comments.length && !canComment) return null;
  const byId = Object.fromEntries(contributors.map((c) => [c.id, c]));
  const shown = comments.slice(-SHOWN);
  const more = comments.length - shown.length;
  return (
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
      {shown.map((c) => {
        const author = byId[c.who];
        return (
          <button
            key={c.id}
            type="button"
            onClick={onOpen}
            style={{
              display: "flex",
              gap: 7,
              alignItems: "flex-start",
              textAlign: "left",
              width: "100%",
              padding: "6px 9px",
              borderRadius: "var(--radius-md)",
              background: "var(--comment-quiet)",
              color: "var(--comment)",
              font: "400 12px/1.4 var(--font-sans)",
            }}
          >
            <span style={{ paddingTop: 2 }}>
              <CommentMark size={11} />
            </span>
            <span style={{ flex: 1, minWidth: 0, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" }}>
              <b style={{ fontWeight: 600 }}>{c.who === currentUserId ? "You" : author?.name ?? "Someone who left"}</b> {c.body}
            </span>
          </button>
        );
      })}
      <button type="button" onClick={onOpen} style={{ alignSelf: "flex-start", padding: 0, font: "500 11.5px var(--font-sans)", color: comments.length ? "var(--accent)" : "var(--text-muted)" }}>
        {more > 0 ? `See all ${comments.length} comments` : comments.length ? (canComment ? "Reply" : "Open") : "+ Comment on this day"}
      </button>
    </div>
  );
}
