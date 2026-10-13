// A speech bubble: a day has comments. Filled in the comment colour, or an
// outline in muted grey for "nothing yet, add one".
export default function CommentMark({ size = 12, filled = true }) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} aria-hidden="true" style={{ flex: "none", display: "block" }}>
      <path
        d="M2.2 1.4h7.6a1.2 1.2 0 0 1 1.2 1.2v4.8a1.2 1.2 0 0 1-1.2 1.2H5.4L2.8 10.8V8.6h-.6A1.2 1.2 0 0 1 1 7.4V2.6a1.2 1.2 0 0 1 1.2-1.2z"
        fill={filled ? "var(--comment-quiet)" : "none"}
        stroke={filled ? "var(--comment)" : "var(--text-muted)"}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * On a day in the Plan tab's day strip: a small square in the comment
 * colour when the day has comments. Bottom right, clear of the weekday and
 * of the day-trip dot above it.
 */
export function DayCommentDot() {
  return (
    <span
      aria-hidden="true"
      style={{ position: "absolute", bottom: 4, right: 4, width: 6, height: 6, borderRadius: 2, background: "var(--comment-mark)" }}
    />
  );
}
