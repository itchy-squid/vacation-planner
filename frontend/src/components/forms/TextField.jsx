export function textFieldStyle({ mono = false, weight = 400, size = 13.5 } = {}) {
  return {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-lg)",
    padding: "12px 13px",
    fontSize: size,
    fontWeight: weight,
    fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
    color: mono ? "var(--text-secondary)" : "var(--text-primary)",
    background: "var(--surface-card)",
    outline: "none",
  };
}

export default function TextField({ label, value, onChange, mono = false, weight, size, placeholder, ...rest }) {
  return (
    <label style={{ display: "block" }}>
      {label ? <div className="mono-caption">{label}</div> : null}
      <input
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        style={{ marginTop: label ? 6 : 0, ...textFieldStyle({ mono, weight, size }) }}
        {...rest}
      />
    </label>
  );
}

export function TextArea({ label, value, onChange, rows = 3, ...rest }) {
  return (
    <label style={{ display: "block" }}>
      {label ? <div className="mono-caption">{label}</div> : null}
      <textarea
        value={value}
        onChange={onChange}
        rows={rows}
        style={{
          marginTop: label ? 6 : 0,
          width: "100%",
          boxSizing: "border-box",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-lg)",
          padding: "11px 13px",
          fontSize: 13.5,
          lineHeight: 1.5,
          fontFamily: "var(--font-sans)",
          color: "var(--text-primary)",
          background: "var(--surface-card)",
          outline: "none",
          resize: "none",
        }}
        {...rest}
      />
    </label>
  );
}
