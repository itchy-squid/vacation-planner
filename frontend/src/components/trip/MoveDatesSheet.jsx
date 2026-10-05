import { useMemo, useState } from "react";
import BottomSheet from "../core/BottomSheet";
import Button from "../core/Button";
import { formatDateRange } from "../../lib/format";
import { dayContents, defaultMove, describeContents, lengthOf, movePreview, movedWords, shortDate, startMovedBy } from "../../lib/tripWhen";

// "Move the plan with the dates?" — asked when a trip's start date moves
// from one date to another with anything on its calendar (lib/tripWhen.js,
// backend app/tripdays.py). Shifting keeps day 1 as day 1, so everything
// moves with the trip; keeping dates leaves everything on the date it was
// on, and sets aside whatever the new dates leave out. A preview shows
// each new day and what will be on it either way.
//
//   before / after  { startDate, endDate } of the trip now and as edited
//   plans, dayPlaces  what's on the calendar now (state)
//   onSave(move)    "shift" | "keep_dates"
export default function MoveDatesSheet({ before, after, plans, dayPlaces, saving, error, onSave, onClose }) {
  const oldLength = lengthOf(before.startDate, before.endDate);
  const newLength = lengthOf(after.startDate, after.endDate);
  const [how, setHow] = useState(() => defaultMove(oldLength, newLength));
  const contents = useMemo(() => dayContents(plans, dayPlaces), [plans, dayPlaces]);
  const preview = useMemo(
    () => movePreview({ contents, oldStart: before.startDate, newStart: after.startDate, newLength, how }),
    [contents, before.startDate, after.startDate, newLength, how]
  );
  const planCount = plans.length;
  const nights = Object.values(dayPlaces ?? {}).filter((d) => d.stay).length;
  const moved = movedWords(startMovedBy(before.startDate, after.startDate));
  const sameLength = oldLength === newLength;

  return (
    <BottomSheet label="Move the plan with the dates?" onClose={onClose}>
      <div style={{ padding: "4px 16px 16px", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
        <div>
          <div className="mono-caption">
            {formatDateRange(before.startDate, before.endDate)} → {formatDateRange(after.startDate, after.endDate)}
          </div>
          <div className="serif-place" style={{ fontSize: 22, lineHeight: 1.2, marginTop: 4 }}>
            Move the plan with the dates?
          </div>
          <div style={{ font: "400 12px/1.45 var(--font-sans)", color: "var(--text-secondary)", marginTop: 2 }}>
            {[planCount ? `${planCount} ${planCount === 1 ? "plan" : "plans"}` : null, nights ? `${nights} ${nights === 1 ? "night’s stay" : "nights’ stays"}` : null]
              .filter(Boolean)
              .join(" and ") || "Some things"}{" "}
            {planCount + nights === 1 ? "is" : "are"} on the calendar.
          </div>
        </div>

        <div role="radiogroup" aria-label="What happens to the plan" style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <Option
            checked={how === "shift"}
            onChange={() => setHow("shift")}
            title={`Shift everything ${moved}`}
            tag={sameLength ? "Same length" : null}
            detail={`Day 1 stays Day 1. ${shortDate(before.startDate)}’s plans move to ${shortDate(after.startDate)}.`}
          />
          <Option
            checked={how === "keep_dates"}
            onChange={() => setHow("keep_dates")}
            title="Keep things on their dates"
            tag={sameLength ? null : "Length changed"}
            detail={`Plans stay on ${formatDateRange(before.startDate, before.endDate)}. Anything outside the new dates is set aside, not deleted.`}
          />
        </div>

        <div className="mono-caption">Preview</div>
        <div style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)", overflow: "hidden", marginTop: -6 }}>
          {preview.rows.map((row) => (
            <PreviewRow
              key={row.day}
              title={`Day ${row.day}`}
              date={shortDate(row.date)}
              from={row.fromDate ? `from ${shortDate(row.fromDate)}` : null}
              what={describeContents(row.contents) || null}
            />
          ))}
          {preview.setAside.map((row) => (
            <PreviewRow key={row.date} title="Set aside" date={shortDate(row.date)} what={describeContents(row.contents)} warn />
          ))}
        </div>

        {error ? <div style={{ font: "500 12.5px var(--font-sans)", color: "var(--warn)" }}>{error}</div> : null}
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="secondary" onClick={onClose} style={{ flex: 1 }}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onSave(how)} disabled={saving} style={{ flex: 1 }}>
            {saving ? "Saving…" : "Save dates"}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}

function Option({ checked, onChange, title, tag, detail }) {
  return (
    <label
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        padding: "10px 12px",
        borderRadius: "var(--radius-lg)",
        border: checked ? "1.5px solid var(--accent)" : "1px solid var(--border)",
        background: checked ? "var(--accent-quiet)" : "var(--surface-card)",
        cursor: "pointer",
      }}
    >
      <input type="radio" checked={checked} onChange={onChange} style={{ width: 17, height: 17, margin: "2px 0 0", accentColor: "var(--accent)", flex: "none" }} />
      <span>
        <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", font: "600 13px var(--font-sans)", color: "var(--text-primary)" }}>
          {title}
          {tag ? (
            <span className="mono-caption" style={{ padding: "2px 5px", borderRadius: 4, border: "1px solid var(--plum-tint-strong)", color: "var(--accent)" }}>
              {tag}
            </span>
          ) : null}
        </span>
        <span style={{ display: "block", font: "400 11.5px/1.45 var(--font-sans)", color: "var(--text-secondary)", marginTop: 2 }}>{detail}</span>
      </span>
    </label>
  );
}

function PreviewRow({ title, date, from = null, what, warn = false }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "baseline",
        padding: "7px 11px",
        borderTop: "1px solid var(--hairline)",
        marginTop: -1,
        background: warn ? "rgba(180, 85, 63, 0.06)" : undefined,
        font: "400 11.5px/1.4 var(--font-sans)",
      }}
    >
      <span style={{ width: 92, flex: "none", font: "600 11.5px var(--font-sans)", color: warn ? "var(--warn)" : "var(--text-primary)" }}>
        {title}
        <span className="mono-caption" style={{ display: "block", color: warn ? "var(--warn)" : undefined }}>
          {date}
        </span>
      </span>
      <span style={{ flex: 1, minWidth: 0, color: warn ? "var(--warn)" : what ? "var(--text-secondary)" : "var(--text-faint)", fontStyle: what ? "normal" : "italic" }}>
        {from ? <span className="mono-caption" style={{ display: "block", color: "var(--accent)" }}>{from}</span> : null}
        {what ?? "Nothing planned"}
      </span>
    </div>
  );
}
