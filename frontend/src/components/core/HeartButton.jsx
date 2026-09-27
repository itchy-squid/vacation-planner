// A heart on an idea: "I'd like to do this" (backend/app/models.py
// PinHeart). Filled in the accent once you've hearted it, an outline
// until then, with how many people have hearted it beside it.
//
// `canHeart` false (readers) still shows the count — it's useful to see
// what the group likes — but as plain text, not a button, and nothing at
// all while nobody has hearted it yet.
//
// `overlay` sets it on a photo (components/planner/PinCard.jsx): a small
// white pill that reads against any image. The button's hit area is padded
// out to the platform minimum around the pill, so a thumb aimed at a small
// heart doesn't open the card underneath instead.
export default function HeartButton({ title, count, hearted, canHeart, onToggle, overlay = false, busy = false }) {
  if (!canHeart && count === 0) return null;

  const pill = (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: overlay ? "4px 8px" : "6px 11px",
        borderRadius: "var(--radius-pill)",
        background: overlay ? "rgba(255,255,255,.94)" : hearted ? "var(--accent-quiet)" : "var(--surface-card)",
        border: overlay ? "none" : `1px solid ${hearted ? "var(--accent)" : "var(--border)"}`,
        color: hearted ? "var(--accent)" : "var(--stone-700)",
        font: "600 11px var(--font-sans)",
        lineHeight: 1,
      }}
    >
      <HeartIcon filled={hearted} />
      {count > 0 ? <span className="mono-data-sm" style={{ color: "inherit", letterSpacing: 0 }}>{count}</span> : null}
    </span>
  );

  const label = `${count} ${count === 1 ? "heart" : "hearts"}`;

  if (!canHeart) {
    return (
      <span role="img" aria-label={label} style={{ display: "inline-flex" }}>
        {pill}
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={hearted}
      aria-label={`Heart ${title} (${label})`}
      disabled={busy}
      onClick={(e) => {
        // On a card, the card itself opens the pin; the heart is its own tap.
        e.stopPropagation();
        onToggle();
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "var(--hit-min)",
        minHeight: "var(--hit-min)",
        margin: overlay ? -8 : 0,
        padding: overlay ? 8 : 0,
      }}
    >
      {pill}
    </button>
  );
}

function HeartIcon({ filled }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" style={{ flex: "none" }}>
      <path
        d="M12 20.5s-7.5-4.6-9.3-9.1C1.5 8.3 3.4 5 6.7 5c2 0 3.4 1.1 4.3 2.5h2C13.9 6.1 15.3 5 17.3 5c3.3 0 5.2 3.3 4 6.4-1.8 4.5-9.3 9.1-9.3 9.1z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
