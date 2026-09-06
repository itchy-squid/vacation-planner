// Buttons: 46px primary/secondary, 40px compact. Sentence case only — see
// design_system/readme.md "Content fundamentals". Press = darker accent,
// nothing scales; hover = stronger tint of the same colour.
const VARIANTS = {
  primary: {
    background: "var(--surface-inverse)",
    color: "#fff",
    border: "none",
  },
  secondary: {
    background: "var(--surface-card)",
    color: "var(--text-primary)",
    border: "1px solid var(--border-strong)",
  },
  accent: {
    background: "var(--accent)",
    color: "#fff",
    border: "none",
  },
};

export default function Button({
  children,
  variant = "primary",
  size = "default", // "default" (46px) | "sm" (40px)
  fullWidth = true,
  disabled = false,
  onClick,
  type = "button",
  style,
  ...rest
}) {
  const v = VARIANTS[variant] ?? VARIANTS.primary;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="hit-target"
      style={{
        height: size === "sm" ? "var(--btn-h-sm)" : "var(--btn-h)",
        width: fullWidth ? "100%" : undefined,
        borderRadius: "var(--radius-lg)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        font: "600 14px var(--font-sans)",
        transition: `background var(--dur-fast) var(--ease-standard), opacity var(--dur-fast)`,
        opacity: disabled ? 0.45 : 1,
        pointerEvents: disabled ? "none" : "auto",
        ...v,
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
