// 28px circles, -8px overlap, 2px white ring, then a "+N" overflow bubble.
// Contributor tints never carry status (design_system readme "Colour").
export default function AvatarStack({ contributors, overflowCount = 0, size = 28 }) {
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {contributors.map((c, i) => (
        <div
          key={c.id}
          title={c.name}
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            background: c.tint,
            border: "2px solid var(--surface-card)",
            marginLeft: i === 0 ? 0 : -8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            font: "600 10px var(--font-sans)",
            color: "var(--text-secondary)",
            position: "relative",
            zIndex: contributors.length - i,
          }}
        >
          {c.initial}
        </div>
      ))}
      {overflowCount > 0 ? (
        <div
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            background: "var(--who-more)",
            border: "2px solid var(--surface-card)",
            marginLeft: -8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            font: "600 10px var(--font-sans)",
            color: "var(--text-secondary)",
          }}
        >
          +{overflowCount}
        </div>
      ) : null}
    </div>
  );
}
