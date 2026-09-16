// Small mono tag naming someone's role on a trip — "OWNER", "READER",
// "YOU'RE A READER". Owner and contributor read in the accent tint (both
// can change the trip); reader stays neutral. Pass children to override
// the label.
export default function RoleTag({ role, children }) {
  const plum = role === "contributor" || role === "owner";
  return (
    <span
      className="mono-caption"
      style={{
        padding: "3px 6px",
        borderRadius: 4,
        background: plum ? "var(--plum-tint-strong)" : "var(--surface-sunken)",
        color: plum ? "var(--accent)" : "var(--stone-700)",
        whiteSpace: "nowrap",
      }}
    >
      {children ?? (role === "owner" ? "Owner" : plum ? "Contributor" : "Reader")}
    </span>
  );
}
