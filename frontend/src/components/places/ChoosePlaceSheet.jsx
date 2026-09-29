import BottomSheet from "../core/BottomSheet";
import PlaceChips from "./PlaceChips";
import { usePlaceChoices } from "./usePlaceChoices";

/**
 * Picks one place for several days at once ("Where we'll be" in Select):
 * the place they stay in, or a day trip to add. Picking closes it.
 */
export default function ChoosePlaceSheet({ title, subtitle, kind, hint, onPick, onClose }) {
  const names = usePlaceChoices();
  return (
    <BottomSheet label={title} onClose={onClose}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "6px 18px 12px", borderBottom: "1px solid var(--hairline)", flex: "none" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mono-caption">{subtitle}</div>
          <div className="serif-place" style={{ fontSize: 21, lineHeight: 1.2, color: "var(--text-primary)", marginTop: 2 }}>
            {title}
          </div>
        </div>
        <button type="button" onClick={onClose} style={{ font: "600 13.5px var(--font-sans)", color: "var(--accent)", paddingTop: 4 }}>
          Cancel
        </button>
      </div>
      <div className="screen-scroll" style={{ padding: "14px 18px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
        <PlaceChips names={names} kind={kind} onPick={onPick} />
        <div style={{ font: "400 12px/1.45 var(--font-sans)", color: "var(--text-muted)" }}>{hint}</div>
      </div>
    </BottomSheet>
  );
}
