import CommentMark from "./CommentMark";

// The comments on a day, as a chip the size of the Ideas board's pin
// badge: a bubble and how many there are, or, on a day with none, a dashed
// "Comment" for someone who can add one (nothing at all for someone who
// can't). Either opens the day's comments (DayCommentsSheet.jsx).
export default function DayCommentChip({ count, canComment, onOpen, day }) {
  if (!count && !canComment) return null;
  const any = count > 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={any ? `${count} comment${count === 1 ? "" : "s"} on day ${day}` : `Comment on day ${day}`}
      style={{
        flex: "none",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        height: 22,
        padding: "0 8px 0 6px",
        borderRadius: "var(--radius-pill)",
        font: `${any ? 600 : 500} 10.5px var(--font-sans)`,
        color: any ? "var(--comment)" : "var(--text-muted)",
        background: any ? "var(--comment-quiet)" : "transparent",
        border: any ? "1px solid var(--comment-line)" : "1px dashed var(--border-strong)",
      }}
    >
      <CommentMark size={12} filled={any} />
      {any ? count : "Comment"}
    </button>
  );
}
