/** A line under the trip: "warn" for what's in the way, "geo" for what's settled. */
export default function TripNote({ tone, children }) {
  const warn = tone === "warn";
  return (
    <div
      role="note"
      style={{
        font: "400 12.5px/1.45 var(--font-sans)",
        padding: "10px 12px",
        borderRadius: "var(--radius-md)",
        color: warn ? "var(--warn)" : "var(--geo)",
        background: warn ? "var(--surface-inset)" : "var(--geo-quiet)",
        border: `1px solid ${warn ? "var(--border)" : "var(--teal-line)"}`,
      }}
    >
      {children}
    </div>
  );
}
