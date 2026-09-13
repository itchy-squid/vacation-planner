import { useRef, useState } from "react";
import Stepper from "../forms/Stepper";
import { fmtMin } from "../../data/derive";
import { clockLabel } from "../../lib/planTime";
import { formatMoney } from "../../data/expenses";

// The stops inside a claimed block, in order.
//
// Stops pack end to end from the window start, in list order, so two of
// them overlapping isn't something to validate against — it can't be
// expressed. Reordering recomputes every start time; that's the whole
// mechanism, and it's why the start-time column is read-only rather than
// an editable field (feature spec §5.3).
const MIN_STOP_MIN = 15;

export default function StopList({ stops, windowStartMin, windowMinutes, onReorder, onChangeDuration, onRemove, onAdd }) {
  const [openKey, setOpenKey] = useState(null);
  const listRef = useRef(null);
  const dragRef = useRef(null);
  const [dragIndex, setDragIndex] = useState(null);

  let cursor = windowStartMin;
  const rows = stops.map((stop) => {
    const start = cursor;
    cursor += stop.durationMinutes;
    return { ...stop, startMin: start };
  });
  const plannedMinutes = stops.reduce((sum, s) => sum + s.durationMinutes, 0);
  const freeMinutes = Math.max(0, windowMinutes - plannedMinutes);

  // Reorder by dragging the handle. The insertion point is whichever row's
  // midpoint the pointer has passed — measured live, because rows are
  // different heights once one is expanded for editing.
  function beginDrag(e, index) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { from: index };
    setDragIndex(index);
  }

  function moveDrag(e) {
    const info = dragRef.current;
    if (!info || !listRef.current) return;
    e.preventDefault();
    const rowEls = [...listRef.current.querySelectorAll("[data-stop-row]")];
    let target = rowEls.length - 1;
    for (let i = 0; i < rowEls.length; i++) {
      const rect = rowEls[i].getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        target = i;
        break;
      }
    }
    if (target !== info.from) {
      onReorder(info.from, target);
      info.from = target;
      setDragIndex(target);
    }
  }

  function endDrag(e) {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragIndex(null);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  // Keyboard equivalent of the same gesture, so reordering isn't
  // pointer-only.
  function handleKey(e, index) {
    if (e.key === "ArrowUp" && index > 0) {
      e.preventDefault();
      onReorder(index, index - 1);
    } else if (e.key === "ArrowDown" && index < stops.length - 1) {
      e.preventDefault();
      onReorder(index, index + 1);
    }
  }

  return (
    <div
      ref={listRef}
      style={{ background: "var(--surface-card)", borderRadius: "var(--radius-lg)", border: "1px solid var(--hairline)", padding: "6px 14px 14px" }}
    >
      {rows.map((stop, index) => {
        const open = openKey === stop.key;
        const trimmed = stop.durationMinutes !== stop.baseDurationMinutes;
        const meta = [
          fmtMin(stop.durationMinutes).toUpperCase(),
          trimmed
            ? `Shortened from ${fmtMin(stop.baseDurationMinutes)}`
            : stop.costCents
            ? `${formatMoney(stop.perHeadCents)} × ${stop.headcount}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ");

        return (
          <div
            key={stop.key}
            data-stop-row
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              padding: "12px 0",
              borderTop: index === 0 ? "none" : "1px solid var(--hairline)",
              opacity: dragIndex === index ? 0.6 : 1,
            }}
          >
            <div className="mono-data-sm" style={{ width: 44, flex: "none", color: "var(--text-muted)", paddingTop: 2 }}>
              {clockLabel(stop.startMin)}
            </div>
            <div aria-hidden="true" style={{ width: 3, alignSelf: "stretch", borderRadius: 2, background: "var(--accent)", flex: "none" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <button
                type="button"
                onClick={() => setOpenKey(open ? null : stop.key)}
                style={{ width: "100%", textAlign: "left" }}
              >
                <div style={{ font: "600 14px var(--font-sans)", color: "var(--text-primary)" }}>{stop.title}</div>
                <div className="mono-data-sm" style={{ color: "var(--text-muted)", marginTop: 2 }}>
                  {meta}
                </div>
              </button>

              {open && (
                <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "flex-end" }}>
                  <div style={{ flex: 1 }}>
                    <Stepper
                      label="How long"
                      valueLabel={fmtMin(stop.durationMinutes)}
                      onDown={() => onChangeDuration(index, Math.max(MIN_STOP_MIN, stop.durationMinutes - 15))}
                      onUp={() => onChangeDuration(index, stop.durationMinutes + 15)}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenKey(null);
                      onRemove(index);
                    }}
                    style={{
                      height: 46,
                      padding: "0 14px",
                      borderRadius: "var(--radius-lg)",
                      border: "1px solid var(--border-strong)",
                      font: "600 13px var(--font-sans)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              aria-label={`Reorder ${stop.title}`}
              onPointerDown={(e) => beginDrag(e, index)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={(e) => handleKey(e, index)}
              style={{
                flex: "none",
                width: 28,
                height: 28,
                color: "var(--text-faint)",
                font: "400 15px var(--font-sans)",
                cursor: "grab",
                touchAction: "none",
              }}
            >
              ⠿
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={onAdd}
        style={{
          width: "100%",
          marginTop: rows.length ? 12 : 6,
          display: "flex",
          gap: 10,
          alignItems: "center",
          textAlign: "left",
        }}
      >
        <span className="mono-data-sm" style={{ width: 44, flex: "none", color: "var(--text-faint)" }}>
          {clockLabel(windowStartMin + plannedMinutes)}
        </span>
        <span
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            border: "1px dashed var(--border-strong)",
            borderRadius: "var(--radius-sm)",
            padding: "9px 12px",
          }}
        >
          <span style={{ font: "400 13px var(--font-sans)", color: "var(--text-muted)" }}>Add a stop</span>
          <span className="mono-data-sm" style={{ color: "var(--text-faint)" }}>
            {fmtMin(freeMinutes)} free
          </span>
        </span>
      </button>
    </div>
  );
}
