import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBed,
  faCalendarDay,
  faChevronLeft,
  faChevronRight,
  faClock,
  faLocationDot,
  faRoute,
} from "@fortawesome/free-solid-svg-icons";
import PhotoPlaceholder from "../core/PhotoPlaceholder";
import HeadsPicker from "./HeadsPicker";
import { usePlannerState, usePlannerDispatch } from "../../state/PlannerContext";
import { textFieldStyle } from "../forms/TextField";

// Everything you can add to a day, behind the one "+ Add" button that
// replaced pages/DaySchedule.jsx's tray (see docs/features/scheduling-
// feature-spec.md "Tray"). Three modes in one bottom sheet:
//
//   menu    — block / pin / custom event
//   picker  — the unplaced items the tray used to lay out as cards
//   custom  — the travel-item form the tray used to hide behind a "+"
//
// They are modes rather than three sheets because "back" has to land on
// the menu with the sheet still open; routing each one would animate the
// whole sheet out and back in for what reads as one panel.
//
// Absolute, not fixed — same reason components/planner/PlanDetailsSheet.jsx
// gives: fixed would let the sheet spill past the app's 430px
// .app-viewport column on a desktop-width window.
const DELETE_CONFIRM_WINDOW_MS = 3000; // matches PlanDetailsSheet's double-tap-to-confirm window

// The three suggested TravelItem kinds (backend/app/schemas.py
// TravelItemKind). One "travel" rather than flight/train/drive: a leg is
// routinely more than one of those, and nothing in the app ever read the
// distinction — see that Literal's comment.
const TRAVEL_KINDS = [
  { value: "travel", label: "Travel", icon: faRoute },
  { value: "lodging", label: "Lodging", icon: faBed },
  { value: "other", label: "Other", icon: faClock },
];

function travelKindIcon(kind) {
  return (TRAVEL_KINDS.find((k) => k.value === kind) ?? TRAVEL_KINDS[2]).icon;
}

export default function AddSheet({ dayIndex, onClose, unplacedPins, unplacedTravelItems, dayRegions, allTripRegions }) {
  const navigate = useNavigate();
  const state = usePlannerState();
  const dispatch = usePlannerDispatch();
  const { trip, contributors } = state;

  const [mode, setMode] = useState("menu");
  const [error, setError] = useState("");

  const unplacedCount = unplacedPins.length + unplacedTravelItems.length;

  return (
    <div
      style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "flex-end", zIndex: 50 }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--surface-card)",
          borderRadius: "20px 20px 0 0",
          boxShadow: "var(--shadow-sheet)",
          padding: "18px 18px 28px",
          width: "100%",
          maxHeight: "78%",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 38, height: 4, borderRadius: 99, background: "var(--stone-250)", margin: "0 auto 14px", flex: "none" }} />

        {error && (
          <div style={{ flex: "none", marginBottom: 10, font: "500 12px var(--font-sans)", color: "var(--warn)" }}>{error}</div>
        )}

        {mode === "menu" && (
          <Menu
            dayIndex={dayIndex}
            unplacedCount={unplacedCount}
            onPropose={() => navigate(`/trips/${trip.id}/schedule/${dayIndex}/propose`)}
            onPick={() => setMode("picker")}
            onCustom={() => setMode("custom")}
          />
        )}

        {mode === "picker" && (
          <Picker
            pins={unplacedPins}
            travelItems={unplacedTravelItems}
            dayRegions={dayRegions}
            allTripRegions={allTripRegions}
            onBack={() => setMode("menu")}
            onArm={(kind, id) => {
              dispatch(kind === "pin" ? { type: "ARM_PLACE_PIN", pinId: id } : { type: "ARM_PLACE_TRAVEL", travelItemId: id });
              onClose();
            }}
            onError={setError}
          />
        )}

        {mode === "custom" && (
          <CustomEventForm
            dayIndex={dayIndex}
            contributors={contributors}
            travellerCount={trip.travellerCount || contributors.length || 1}
            onBack={() => setMode("menu")}
            onCreated={(id) => {
              dispatch({ type: "ARM_PLACE_TRAVEL", travelItemId: id });
              onClose();
            }}
            onError={setError}
            dispatch={dispatch}
          />
        )}
      </div>
    </div>
  );
}

// ---- menu -----------------------------------------------------------------

function Menu({ dayIndex, unplacedCount, onPropose, onPick, onCustom }) {
  return (
    <div>
      <div className="mono-caption" style={{ marginBottom: 6 }}>Add to day {dayIndex}</div>
      {/* Tint per meaning, not per row: plum is the decisions-and-votes
          family, teal is geography, stone is neither (styles/tokens/
          colors.css, "one hue family per meaning"). */}
      <MenuRow
        icon={faCalendarDay}
        tint="var(--plum-tint-strong)"
        ink="var(--accent)"
        title="Propose a block"
        subtitle="Pick hours, then fill them"
        onClick={onPropose}
      />
      <MenuRow
        icon={faLocationDot}
        tint="var(--geo-quiet)"
        ink="var(--geo)"
        title="Add a pin"
        subtitle={unplacedCount === 1 ? "1 unplaced item" : `${unplacedCount} unplaced items`}
        onClick={onPick}
        disabled={unplacedCount === 0}
      />
      <MenuRow
        icon={faClock}
        tint="var(--surface-sunken)"
        ink="var(--text-secondary)"
        title="Custom event"
        subtitle="Something that isn't a pin"
        onClick={onCustom}
        last
      />
    </div>
  );
}

function MenuRow({ icon, tint, ink, title, subtitle, onClick, disabled = false, last = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "11px 4px",
        borderBottom: last ? "none" : "1px solid var(--hairline)",
        textAlign: "left",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <span
        style={{
          width: 40,
          height: 40,
          flex: "none",
          borderRadius: "var(--radius-md)",
          background: tint,
          color: ink,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <FontAwesomeIcon icon={icon} style={{ width: 17, height: 17 }} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", font: "600 13.5px var(--font-sans)", color: "var(--text-primary)" }}>{title}</span>
        <span style={{ display: "block", font: "400 12px var(--font-sans)", color: "var(--text-secondary)", marginTop: 2 }}>
          {subtitle}
        </span>
      </span>
      <FontAwesomeIcon icon={faChevronRight} style={{ width: 11, height: 11, flexShrink: 0, color: "var(--text-faint)" }} />
    </button>
  );
}

// ---- sheet header shared by the two sub-modes -----------------------------

function SubHeader({ onBack, title, right = null }) {
  return (
    <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        style={{ width: 32, height: 32, marginLeft: -6, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent)" }}
      >
        <FontAwesomeIcon icon={faChevronLeft} style={{ width: 13, height: 13 }} />
      </button>
      <div className="serif-place" style={{ flex: 1, fontSize: 19, color: "var(--text-primary)" }}>{title}</div>
      {right}
    </div>
  );
}

// ---- picker ---------------------------------------------------------------

function Picker({ pins, travelItems, dayRegions, allTripRegions, onBack, onArm, onError }) {
  const dispatch = usePlannerDispatch();
  const { placing } = usePlannerState();

  // Defaults to the regions this day is already about, exactly as the
  // tray's filter did — a block on the Xiaoliuqiu day opens showing
  // Xiaoliuqiu. An empty list means "All".
  const [filter, setFilter] = useState(dayRegions);
  const filterIsDefault = useMemo(
    () => filter.length === dayRegions.length && filter.every((r) => dayRegions.includes(r)),
    [filter, dayRegions]
  );

  const shownPins = useMemo(() => {
    const set = filter.length ? new Set(filter) : null;
    return pins.filter((p) => !set || set.has(p.region));
  }, [pins, filter]);

  // One armed slot across the whole list, since only one row can
  // plausibly be mid-confirm at a time — the rule the tray used, kept.
  const [armedKey, setArmedKey] = useState(null);
  const timeoutRef = useRef(null);
  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  function handleDeleteTap(kind, id) {
    const key = `${kind}:${id}`;
    if (armedKey !== key) {
      setArmedKey(key);
      clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setArmedKey(null), DELETE_CONFIRM_WINDOW_MS);
      return;
    }
    clearTimeout(timeoutRef.current);
    setArmedKey(null);
    onError("");
    dispatch({ type: kind === "pin" ? "DELETE_PIN" : "DELETE_TRAVEL_ITEM", id }).then((result) => {
      if (result.ok) {
        // The deleted item may be the one currently armed for placement —
        // clear that too, or the grid would go on trying to place
        // something that no longer exists.
        if (placing?.kind === kind && placing.refId === id) dispatch({ type: "CANCEL_PLACING" });
      } else {
        onError("Couldn't delete that item — try again.");
      }
    });
  }

  return (
    <>
      <SubHeader
        onBack={onBack}
        title="Unplaced"
        right={
          !filterIsDefault && dayRegions.length > 0 ? (
            <button type="button" onClick={() => setFilter(dayRegions)} style={{ font: "500 11px var(--font-sans)", color: "var(--accent)" }}>
              reset filter
            </button>
          ) : null
        }
      />

      {allTripRegions.length > 1 && (
        <div style={{ flex: "none", display: "flex", gap: 6, overflowX: "auto", margin: "10px 0 4px" }}>
          {["All", ...allTripRegions].map((r) => {
            const selected = r === "All" ? filter.length === 0 : filter.includes(r);
            return (
              <button
                key={r}
                type="button"
                onClick={() =>
                  r === "All"
                    ? setFilter([])
                    : setFilter((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]))
                }
                style={{
                  flex: "none",
                  padding: "6px 12px",
                  borderRadius: "var(--radius-pill)",
                  font: "500 11.5px var(--font-sans)",
                  whiteSpace: "nowrap",
                  background: selected ? "var(--surface-inverse)" : "var(--surface-card)",
                  color: selected ? "#fff" : "var(--text-primary)",
                  border: selected ? "none" : "1px solid var(--border-strong)",
                }}
              >
                {r}
              </button>
            );
          })}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {/* Travel items sit in their own section rather than mixed into
            the pins: they have no region, so the filter above says
            nothing about them, and burying an unplaced ferry among
            twenty pins is how it gets forgotten. */}
        {travelItems.length > 0 && (
          <>
            <div className="mono-caption" style={{ marginTop: 10 }}>Travel</div>
            {travelItems.map((item) => (
              <PickerRow
                key={`t${item.id}`}
                title={item.title}
                meta={`${TRAVEL_KINDS.find((k) => k.value === item.kind)?.label ?? "Other"} · ${item.dur}m`}
                icon={travelKindIcon(item.kind)}
                armed={armedKey === `travel:${item.id}`}
                onArm={() => onArm("travel", item.id)}
                onDelete={() => handleDeleteTap("travel", item.id)}
              />
            ))}
          </>
        )}

        <div className="mono-caption" style={{ marginTop: travelItems.length ? 16 : 10 }}>Pins</div>
        {shownPins.length ? (
          shownPins.map((pin) => (
            <PickerRow
              key={pin.id}
              title={pin.title}
              meta={`${pin.region} · ${pin.dur}m`}
              photoUrl={pin.photoUrl}
              armed={armedKey === `pin:${pin.id}`}
              onArm={() => onArm("pin", pin.id)}
              onDelete={() => handleDeleteTap("pin", pin.id)}
            />
          ))
        ) : (
          <div style={{ padding: "12px 0", font: "400 12px var(--font-sans)", color: "var(--text-muted)" }}>
            {filter.length ? "No unplaced pins in these regions." : "Every pin is on the calendar."}
          </div>
        )}

        <div style={{ marginTop: 14, font: "400 11.5px/1.45 var(--font-sans)", color: "var(--text-muted)" }}>
          Tap an item to place it, then tap the calendar.
        </div>
      </div>
    </>
  );
}

function PickerRow({ title, meta, photoUrl, icon, armed, onArm, onDelete }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 0", borderBottom: "1px solid var(--hairline)" }}>
      <button type="button" onClick={onArm} style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 12, textAlign: "left" }}>
        {icon ? (
          <span
            style={{
              width: 44,
              height: 44,
              flex: "none",
              borderRadius: "var(--radius-md)",
              background: "var(--surface-sunken)",
              color: "var(--text-secondary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <FontAwesomeIcon icon={icon} style={{ width: 16, height: 16 }} />
          </span>
        ) : (
          <span style={{ width: 44, flex: "none" }}>
            <PhotoPlaceholder height={44} radius="var(--radius-md)" label="" src={photoUrl} />
          </span>
        )}
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", font: "600 13px var(--font-sans)", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {title}
          </span>
          <span
            className="mono-data-sm"
            style={{ display: "block", marginTop: 3, color: armed ? "var(--danger, #b3261e)" : "var(--text-muted)" }}
          >
            {armed ? "Tap again to delete permanently" : meta}
          </span>
        </span>
      </button>
      {/* Sized to --hit-min rather than a decorative glyph: it sits beside
          a row whose whole body is also tappable, so the two targets have
          to be separable by thumb. */}
      <button
        type="button"
        onClick={onDelete}
        aria-label={armed ? "Confirm delete" : "Delete permanently"}
        style={{
          width: "var(--hit-min, 44px)",
          height: "var(--hit-min, 44px)",
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: armed ? "var(--danger, #b3261e)" : "transparent",
            color: armed ? "#fff" : "var(--text-faint)",
            font: armed ? "700 16px var(--font-sans)" : "400 17px var(--font-sans)",
          }}
        >
          {armed ? "!" : "×"}
        </span>
      </button>
    </div>
  );
}

// ---- custom event ---------------------------------------------------------

function CustomEventForm({ dayIndex, contributors, travellerCount, onBack, onCreated, onError, dispatch }) {
  const [draft, setDraft] = useState({ title: "", kind: "other", dur: 60, cost: 0, heads: [] });
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!draft.title.trim() || busy) return;
    setBusy(true);
    onError("");
    try {
      const created = await dispatch({
        type: "CREATE_TRAVEL_ITEM",
        payload: {
          title: draft.title.trim(),
          kind: draft.kind,
          duration_minutes: Math.max(5, Number(draft.dur) || 60),
          cost_cents: Math.round((Number(draft.cost) || 0) * 100),
        },
      });
      if (draft.heads.length) {
        // TravelItemCreate doesn't take heads (backend/app/schemas.py), so
        // a non-default split is a follow-up patch rather than part of
        // the create.
        await dispatch({ type: "PATCH_TRAVEL_ITEM", id: created.id, fields: { heads: draft.heads } });
      }
      onCreated(created.id);
    } catch {
      onError("Couldn't add that — try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <SubHeader onBack={onBack} title="Custom event" />
      <form onSubmit={submit} style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, paddingTop: 12 }}>
        <label style={{ display: "block" }}>
          <div className="mono-caption">Title</div>
          <input
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder="Scooter hire, Baisha pier"
            style={{ marginTop: 6, ...textFieldStyle() }}
          />
        </label>

        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <label style={{ flex: 1, minWidth: 0 }}>
            <div className="mono-caption">Kind</div>
            <select
              value={draft.kind}
              onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value }))}
              style={{ marginTop: 6, ...textFieldStyle() }}
            >
              {TRAVEL_KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
          </label>
          <label style={{ width: 86, flex: "none" }}>
            <div className="mono-caption">Minutes</div>
            <input
              type="number"
              min={5}
              value={draft.dur}
              onChange={(e) => setDraft((d) => ({ ...d, dur: e.target.value }))}
              style={{ marginTop: 6, ...textFieldStyle({ mono: true }) }}
            />
          </label>
          <label style={{ width: 86, flex: "none" }}>
            <div className="mono-caption">Cost $</div>
            <input
              type="number"
              min={0}
              value={draft.cost}
              onChange={(e) => setDraft((d) => ({ ...d, cost: e.target.value }))}
              style={{ marginTop: 6, ...textFieldStyle({ mono: true }) }}
            />
          </label>
        </div>

        <HeadsPicker
          contributors={contributors}
          value={draft.heads}
          onChange={(heads) => setDraft((d) => ({ ...d, heads }))}
          travellerCount={travellerCount}
        />

        {/* "Add and place", not the tray's old "Add to tray": this sheet
            is opened from a day, so creating something here arms it for
            that day's calendar exactly as picking a pin does. It still
            lands in the unplaced list if the placement is cancelled. */}
        <button
          type="submit"
          disabled={busy || !draft.title.trim()}
          style={{
            height: 46,
            flex: "none",
            borderRadius: "var(--radius-lg)",
            background: "var(--surface-inverse)",
            color: "#fff",
            font: "600 14px var(--font-sans)",
            opacity: busy || !draft.title.trim() ? 0.45 : 1,
          }}
        >
          Add to day {dayIndex} and place
        </button>
      </form>
    </>
  );
}
