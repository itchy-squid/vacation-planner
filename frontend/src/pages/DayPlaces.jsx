import { useCallback, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import HomeButton from "../components/core/HomeButton";
import Toast from "../components/core/Toast";
import DayPlacesSheet from "../components/places/DayPlacesSheet";
import ChoosePlaceSheet from "../components/places/ChoosePlaceSheet";
import { useCan, usePlannerDispatch, usePlannerState } from "../state/PlannerContext";
import { getTripDays, tripDayTitle } from "../data/trip";
import {
  NO_PLACES,
  calendarPlacesOnDay,
  dayRangeLabel,
  describeDay,
  distinctRegions,
  isSet,
  joinNames,
  placesOn,
  stayBefore,
  stayRun,
  timelineAt,
  tripDayNumbers,
  withStay,
  withVisit,
} from "../lib/dayPlaces";

// "Where we'll be": which place the group is in on each day of the trip
// (lib/dayPlaces.js). Every day in a list; tap one to set it
// (components/places/DayPlacesSheet.jsx), or Select several and set or
// clear them together. Bulk changes offer Undo. Opened from the Plan tab's
// day header ("All days"), and back there with ‹ Plan. Anyone on the trip
// can look; planners (plans:write) can change it.
export default function DayPlaces() {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = usePlannerDispatch();
  const can = useCan();
  const { trip, dayPlaces, plans, pins } = usePlannerState();
  const canEdit = can("plans:write");

  const dates = useMemo(() => tripDayNumbers(trip), [trip]);
  const labels = useMemo(() => getTripDays(trip), [trip]);
  const back = `/trips/${trip.id}/schedule/${location.state?.fromDay ?? 1}`;

  const [openIndex, setOpenIndex] = useState(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState([]); // day indexes, 0-based
  const [choosing, setChoosing] = useState(null); // "stay" | "visit"
  const [confirmingClearAll, setConfirmingClearAll] = useState(false);
  const [toast, setToast] = useState(null); // { message, previous }
  const [error, setError] = useState("");

  const setCount = dates.filter((d) => isSet(placesOn(dayPlaces, d))).length;
  const selectedNumbers = selected.map((i) => i + 1);

  // Where the calendar already puts an unset day, offered as its stay.
  const suggestions = useMemo(
    () => dates.map((_, i) => distinctRegions(calendarPlacesOnDay(plans, pins, i + 1))),
    [dates, plans, pins]
  );

  async function save(days, message) {
    setError("");
    const result = await dispatch({ type: "SAVE_DAY_PLACES", days });
    if (!result?.ok) {
      setError(result?.error ? `Couldn’t save: ${result.error}` : "Couldn’t save. Try again.");
      return false;
    }
    if (message) setToast({ message, previous: result.previous });
    return true;
  }

  const undo = useCallback(() => {
    if (toast?.previous) dispatch({ type: "SAVE_DAY_PLACES", days: toast.previous });
  }, [dispatch, toast]);
  const hideToast = useCallback(() => setToast(null), []);

  function stopSelecting() {
    setSelecting(false);
    setSelected([]);
  }

  function startSelecting() {
    setSelecting(true);
    setConfirmingClearAll(false);
  }

  async function applyToSelected(kind, name) {
    const days = Object.fromEntries(
      selected.map((i) => {
        const day = placesOn(dayPlaces, dates[i]);
        return [dates[i], kind === "stay" ? withStay(day, name) : withVisit(day, name)];
      })
    );
    const label = dayRangeLabel(selectedNumbers);
    setChoosing(null);
    if (await save(days, kind === "stay" ? `${label}: staying in ${name}.` : `${label}: day trip to ${name}.`)) stopSelecting();
  }

  async function clearSelected() {
    const days = Object.fromEntries(selected.map((i) => [dates[i], NO_PLACES]));
    if (await save(days, `Cleared ${dayRangeLabel(selectedNumbers)}.`)) stopSelecting();
  }

  async function clearAll() {
    setConfirmingClearAll(false);
    const days = Object.fromEntries(dates.filter((d) => isSet(placesOn(dayPlaces, d))).map((d) => [d, NO_PLACES]));
    await save(days, `Cleared all ${dates.length} days.`);
  }

  const toggleSelected = (i) => setSelected((current) => (current.includes(i) ? current.filter((x) => x !== i) : [...current, i]));

  return (
    <div className="screen" style={{ position: "relative" }}>
      <div style={{ flex: "none", display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "20px 16px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <HomeButton size={28} />
          <button type="button" onClick={() => navigate(back)} style={{ font: "500 13px var(--font-sans)", color: "var(--accent)" }}>
            ‹ Plan
          </button>
        </div>
        <span className="mono-caption">Where we’ll be</span>
        {canEdit && dates.length ? (
          <button
            type="button"
            onClick={selecting ? stopSelecting : startSelecting}
            style={{ justifySelf: "end", font: "600 13px var(--font-sans)", color: "var(--accent)" }}
          >
            {selecting ? "Cancel" : "Select"}
          </button>
        ) : (
          <span />
        )}
      </div>

      <div style={{ flex: "none", padding: "0 var(--gutter-text) 12px" }}>
        <div className="serif-place" style={{ fontSize: 23, lineHeight: 1.2, color: "var(--text-primary)" }}>
          {trip.name}
        </div>
        <div style={{ font: "400 12px var(--font-sans)", color: "var(--text-secondary)", marginTop: 2 }}>
          {trip.dateLine}
          {dates.length ? ` · ${setCount} of ${dates.length} days set` : ""}
        </div>
        {error ? (
          <div role="alert" style={{ marginTop: 8, font: "500 12.5px var(--font-sans)", color: "var(--warn)" }}>
            {error}
          </div>
        ) : null}
      </div>

      {dates.length === 0 ? (
        <NoDates canManage={can("trip:manage")} onSettings={() => navigate(`/trips/${trip.id}/trip-settings`)} />
      ) : (
        <div className="screen-scroll" style={{ background: "var(--surface-card)", borderTop: "1px solid var(--hairline)" }}>
          <ol aria-label="Days of the trip">
            {dates.map((date, i) => (
              <DayRow
                key={date}
                number={i + 1}
                label={labels[i]}
                title={tripDayTitle(i + 1, trip)}
                day={placesOn(dayPlaces, date)}
                run={stayRun(dayPlaces, dates, i)}
                timeline={timelineAt(dayPlaces, dates, i)}
                previousStay={stayBefore(dayPlaces, dates, i)}
                lodging={pins[placesOn(dayPlaces, date).lodgingPinId]?.title ?? null}
                suggestion={suggestions[i]}
                canEdit={canEdit}
                selecting={selecting}
                selected={selected.includes(i)}
                onOpen={() => (selecting ? toggleSelected(i) : setOpenIndex(i))}
                onUse={() => save({ [date]: withStay(NO_PLACES, suggestions[i][0]) }, `Day ${i + 1}: staying in ${suggestions[i][0]}.`)}
              />
            ))}
          </ol>
          {!selecting ? (
            <Footer
              canEdit={canEdit}
              anySet={setCount > 0}
              confirming={confirmingClearAll}
              dayCount={dates.length}
              onAsk={() => setConfirmingClearAll(true)}
              onKeep={() => setConfirmingClearAll(false)}
              onClearAll={clearAll}
            />
          ) : null}
        </div>
      )}

      {selecting ? (
        <BulkBar
          count={selected.length}
          label={selected.length ? `${dayRangeLabel(selectedNumbers)} selected` : "Tap the days to change"}
          onStay={() => setChoosing("stay")}
          onVisit={() => setChoosing("visit")}
          onClear={clearSelected}
        />
      ) : null}

      {openIndex != null ? (
        <DayPlacesSheet
          index={openIndex}
          onStep={setOpenIndex}
          onClose={() => setOpenIndex(null)}
          onCleared={setToast}
        />
      ) : null}

      {choosing ? (
        <ChoosePlaceSheet
          kind={choosing}
          title={choosing === "stay" ? "Staying in…" : "Add a day trip to…"}
          subtitle={dayRangeLabel(selectedNumbers)}
          hint={
            choosing === "stay"
              ? "Replaces where each selected day is staying. Their day trips stay, unless one is to this place."
              : "Added after any day trips those days already have. Skipped on a day you’re staying there."
          }
          onPick={(name) => applyToSelected(choosing, name)}
          onClose={() => setChoosing(null)}
        />
      ) : null}

      <Toast message={toast?.message} actionLabel="Undo" onAction={toast?.previous ? undo : null} onDone={hideToast} />
    </div>
  );
}

function DayRow({ number, label, title, day, run, timeline, previousStay, lodging, suggestion, canEdit, selecting, selected, onOpen, onUse }) {
  const set = isSet(day);
  const summary = set ? describeDay(day, previousStay, lodging) : "Not set";
  const offerUse = canEdit && !selecting && !set && suggestion.length > 0;
  const Main = canEdit ? "button" : "div";

  return (
    <li style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "stretch", borderBottom: "1px solid var(--hairline)", background: selected ? "var(--accent-quiet)" : "transparent" }}>
      <Main
        {...(canEdit
          ? { type: "button", onClick: onOpen, "aria-pressed": selecting ? selected : undefined, "aria-label": `Day ${number}, ${title}: ${summary}` }
          : {})}
        style={{ display: "grid", gridTemplateColumns: "40px 16px minmax(0, 1fr) 16px", gap: 8, alignItems: "stretch", minHeight: 56, padding: "0 4px 0 14px", textAlign: "left", width: "100%" }}
      >
        <span style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1.1 }}>
          <span className="mono-data-sm" style={{ color: "var(--text-faint)", letterSpacing: 0 }}>{label?.dow || "DAY"}</span>
          <span style={{ font: "600 15px var(--font-sans)", color: "var(--text-primary)" }}>{label?.n ?? number}</span>
        </span>
        <Timeline {...timeline} />
        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", alignContent: "center", gap: "4px 6px", padding: "8px 0", minWidth: 0 }}>
          {run.movedFrom ? (
            <span className="mono-caption" style={{ width: "100%", fontSize: 10 }}>
              from {run.movedFrom}
            </span>
          ) : null}
          {day.stay ? <span style={{ font: "600 13.5px var(--font-sans)", color: "var(--text-primary)" }}>{day.stay}</span> : null}
          {day.stay && lodging ? <span style={{ font: "400 12px var(--font-sans)", color: "var(--text-secondary)" }}>at {lodging}</span> : null}
          {day.visits.map((v) => (
            <span key={v} style={visitChip}>
              + {v}
            </span>
          ))}
          {!set ? <span style={{ font: "500 12.5px var(--font-sans)", color: "var(--text-faint)" }}>Not set</span> : null}
          {!day.stay && day.visits.length ? <span style={{ font: "400 11px var(--font-sans)", color: "var(--text-muted)" }}>no stay set</span> : null}
          {!set && suggestion.length ? (
            <span style={{ width: "100%", font: "400 11.5px var(--font-sans)", color: "var(--text-secondary)" }}>
              Plans are in {joinNames(suggestion)}
            </span>
          ) : null}
        </span>
        <span aria-hidden="true" style={{ alignSelf: "center", textAlign: "right", color: "var(--text-faint)" }}>
          {selecting ? <Check on={selected} /> : canEdit && !offerUse ? "›" : ""}
        </span>
      </Main>
      {offerUse ? (
        <button type="button" onClick={onUse} aria-label={`Use ${suggestion[0]} for Day ${number}`} style={{ padding: "0 16px 0 6px", font: "600 12.5px var(--font-sans)", color: "var(--accent)" }}>
          Use {suggestion[0]}
        </button>
      ) : null}
    </li>
  );
}

// The trip's timeline down the left (lib/dayPlaces.js timelineAt): one
// line through every day, with a dot where the group arrives somewhere new.
function Timeline({ top, bottom, dot }) {
  return (
    <span aria-hidden="true" style={{ position: "relative" }}>
      {top ? <TimelineSegment kind={top} style={{ top: -1, bottom: "50%" }} /> : null}
      {bottom ? <TimelineSegment kind={bottom} style={{ top: "50%", bottom: -1 }} /> : null}
      {dot ? (
        <span
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: 11,
            height: 11,
            margin: "-5.5px 0 0 -5.5px",
            borderRadius: "50%",
            background: "var(--surface-card)",
            border: "3px solid var(--geo)",
            boxSizing: "border-box",
          }}
        />
      ) : null}
    </span>
  );
}

// Solid between days with a stay; dashed and faint where one isn't set.
function TimelineSegment({ kind, style }) {
  return (
    <span
      style={{
        position: "absolute",
        left: "50%",
        width: 2,
        marginLeft: -1,
        background:
          kind === "solid" ? "var(--geo)" : "repeating-linear-gradient(to bottom, var(--border-strong) 0 4px, transparent 4px 8px)",
        ...style,
      }}
    />
  );
}

function Check({ on }) {
  return (
    <span
      style={{
        display: "inline-grid",
        placeItems: "center",
        width: 18,
        height: 18,
        borderRadius: "50%",
        border: `1.5px solid ${on ? "var(--accent)" : "var(--border-strong)"}`,
        background: on ? "var(--accent)" : "transparent",
        color: "#fff",
        font: "700 10px var(--font-sans)",
      }}
    >
      {on ? "✓" : ""}
    </span>
  );
}

function Footer({ canEdit, anySet, confirming, dayCount, onAsk, onKeep, onClearAll }) {
  if (!canEdit) {
    return <p style={{ ...footerText, padding: "14px 16px 24px" }}>Planners set where the group is each day.</p>;
  }
  if (confirming) {
    return (
      <div style={{ margin: 16, padding: "11px 13px", borderRadius: "var(--radius-lg)", border: "1px solid var(--warn)", display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={{ font: "400 12.5px/1.45 var(--font-sans)", color: "var(--text-primary)" }}>
          Clear the places on all {dayCount} days? Ideas and plans stay as they are.
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={onKeep} style={{ ...footerButton, border: "1px solid var(--border-strong)", color: "var(--text-primary)" }}>
            Keep them
          </button>
          <button type="button" onClick={onClearAll} style={{ ...footerButton, background: "var(--warn)", color: "#fff" }}>
            Clear all days
          </button>
        </div>
      </div>
    );
  }
  return (
    <div style={{ padding: "14px 16px 24px", display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
      <span style={footerText}>Tap a day to set it, or Select to set several at once.</span>
      {anySet ? (
        <button type="button" onClick={onAsk} style={{ font: "600 12.5px var(--font-sans)", color: "var(--warn)" }}>
          Clear every day…
        </button>
      ) : null}
    </div>
  );
}

function BulkBar({ count, label, onStay, onVisit, onClear }) {
  const disabled = count === 0;
  return (
    <div style={{ flex: "none", background: "var(--surface-inverse)", padding: "10px 14px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="mono-caption" style={{ color: "var(--text-on-dark-muted)" }}>
        {label}
      </span>
      <div style={{ display: "flex", gap: 6 }}>
        <BulkButton primary disabled={disabled} onClick={onStay}>
          Staying in…
        </BulkButton>
        <BulkButton disabled={disabled} onClick={onVisit}>
          + Day trip…
        </BulkButton>
        <BulkButton disabled={disabled} onClick={onClear}>
          Clear
        </BulkButton>
      </div>
    </div>
  );
}

function BulkButton({ primary = false, disabled, onClick, children }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        flex: 1,
        height: 40,
        borderRadius: "var(--radius-md)",
        border: primary ? "none" : "1px solid var(--border-on-dark)",
        background: primary ? "var(--accent)" : "transparent",
        color: "#fff",
        font: "600 12.5px var(--font-sans)",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}

function NoDates({ canManage, onSettings }) {
  return (
    <div style={{ padding: "8px var(--gutter-text)", display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
      <p style={{ font: "400 13px/1.5 var(--font-sans)", color: "var(--text-secondary)" }}>
        This trip doesn’t have dates yet. Once it does, you can say where the group will be on each day.
      </p>
      {canManage ? (
        <button type="button" onClick={onSettings} style={{ font: "600 13px var(--font-sans)", color: "var(--accent)" }}>
          Set the dates in trip settings ›
        </button>
      ) : null}
    </div>
  );
}

const visitChip = {
  font: "500 11px var(--font-sans)",
  padding: "2px 8px",
  borderRadius: "var(--radius-pill)",
  border: "1.5px dashed var(--teal-line)",
  color: "var(--geo)",
  whiteSpace: "nowrap",
};

const footerText = { font: "400 12px var(--font-sans)", color: "var(--text-muted)" };

const footerButton = { flex: 1, height: 38, borderRadius: "var(--radius-md)", font: "600 12.5px var(--font-sans)" };
