import { useRef, useState } from "react";
import Stepper from "../forms/Stepper";
import { fmtMin } from "../../data/derive";
import { clockLabel } from "../../lib/planTime";
import { formatMoney } from "../../data/expenses";

// The stops inside a claimed block, in order, with the times they happen.
//
// Each stop carries the free time *before* it rather than an absolute
// start, which is what lets this list do two things that pull against each
// other. Times are editable — "the museum at 14:00, dinner at 17:00, and
// the two hours between them are the walk" is expressible, where a packed
// list could only ever say "one thing straight after another". And two
// stops still cannot overlap: a stop begins where the one before it ended
// plus some number of minutes that is never negative, so overlap is not a
// thing to validate against, it is a thing that cannot be written down
// (feature spec §5.3, which this widens rather than replaces).
//
// It is also why the drag handle still means what it always meant.
// Reordering recomputes every start from the top, exactly as it did when
// the list was packed solid — the gaps ride along with their stops.
const MIN_STOP_MIN = 15;
const STEP_MIN = 15;

export default function StopList({
  stops,
  windowStartMin,
  windowMinutes,
  onReorder,
  onChangeDuration,
  onChangeGap,
  onRemove,
  onAdd,
}) {
  const [openKey, setOpenKey] = useState(null);
  const listRef = useRef(null);
  const dragRef = useRef(null);
  const [dragIndex, setDragIndex] = useState(null);

  let cursor = windowStartMin;
  const rows = stops.map((stop) => {
    cursor += stop.gapBefore ?? 0;
    const start = cursor;
    cursor += stop.durationMinutes;
    return { ...stop, startMin: start };
  });
  const spanMinutes = cursor - windowStartMin;
  const freeMinutes = Math.max(0, windowMinutes - spanMinutes);

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
        const gap = stop.gapBefore ?? 0;
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
          <div key={stop.key}>
            {/* Free time gets a line of its own rather than being left as
                the difference between two clock times for the reader to
                work out. It is also the thing most worth seeing at a
                glance: it is what the block has left to give. */}
            {gap > 0 && (
              <div className="mono-data-sm" style={{ padding: "6px 0 6px 54px", color: "var(--text-faint)" }}>
                {fmtMin(gap).toUpperCase()} free
              </div>
            )}
            <div
              data-stop-row
              style={{
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
                padding: "12px 0",
                borderTop: index === 0 || gap > 0 ? "none" : "1px solid var(--hairline)",
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
                  <>
                    <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
                      {/* "Starts" moves this stop and everything after it,
                          because what it really edits is the free time in
                          front of it. That is the same reading as dragging
                          a stop later on a calendar and finding the rest of
                          the afternoon still behind it. */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Stepper
                          label="Starts"
                          valueLabel={clockLabel(stop.startMin)}
                          onDown={() => onChangeGap(index, Math.max(0, gap - STEP_MIN))}
                          onUp={() => onChangeGap(index, gap + STEP_MIN)}
                        />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Stepper
                          label="How long"
                          valueLabel={fmtMin(stop.durationMinutes)}
                          onDown={() => onChangeDuration(index, Math.max(MIN_STOP_MIN, stop.durationMinutes - STEP_MIN))}
                          onUp={() => onChangeDuration(index, stop.durationMinutes + STEP_MIN)}
                        />
                      </div>
                    </div>
                    <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                      <span className="mono-data-sm" style={{ color: "var(--text-faint)" }}>
                        Ends {clockLabel(stop.startMin + stop.durationMinutes)}
                      </span>
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
                  </>
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
          {clockLabel(windowStartMin + spanMinutes)}
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
