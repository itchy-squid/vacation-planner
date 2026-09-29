import { useMemo, useState } from "react";
import BottomSheet from "../core/BottomSheet";
import PlaceChips from "./PlaceChips";
import { useKnownRegions } from "../map/useKnownRegions";
import { usePlannerDispatch, usePlannerState } from "../../state/PlannerContext";
import { tripDayTitle } from "../../data/trip";
import {
  NO_PLACES,
  calendarPlacesOnDay,
  includesPlace,
  isSet,
  placeNames,
  placesOn,
  samePlace,
  stayRun,
  tripDates,
  withStay,
  withVisit,
  withoutVisit,
} from "../../lib/dayPlaces";

/**
 * One day's places: where the group stays that night (one, tap again to
 * clear) and its day trips, in order. Each tap saves. Opened from
 * "Where we'll be" (pages/DayPlaces.jsx) and from the Plan tab's day
 * header (pages/DaySchedule.jsx).
 *
 *   index      which day of the trip, 0-based
 *   onStep     (index) -> show another day in the same sheet
 *   onCleared  ({ message, previous }) after "Clear this day", for an Undo
 */
export default function DayPlacesSheet({ index, onStep, onClose, onCleared }) {
  const dispatch = usePlannerDispatch();
  const { dayPlaces, plans, pins, trip } = usePlannerState();
  const names = useKnownRegions();
  const [error, setError] = useState("");

  const dates = useMemo(() => tripDates(trip.startDate, trip.endDate), [trip.startDate, trip.endDate]);
  const date = dates[index];
  const day = placesOn(dayPlaces, date);
  const yesterday = index > 0 ? placesOn(dayPlaces, dates[index - 1]) : NO_PLACES;
  const { movedFrom } = stayRun(dayPlaces, dates, index);
  const onCalendar = useMemo(() => calendarPlacesOnDay(plans, pins, trip.startDate, index + 1), [plans, pins, trip.startDate, index]);
  const listed = placeNames(day);

  async function save(next) {
    setError("");
    const result = await dispatch({ type: "SAVE_DAY_PLACES", days: { [date]: next } });
    if (!result?.ok) setError(result?.error ? `Couldn’t save: ${result.error}` : "Couldn’t save. Try again.");
    return result;
  }

  async function clearDay() {
    const result = await save(NO_PLACES);
    if (result?.ok) onCleared?.({ message: `Cleared Day ${index + 1}.`, previous: result.previous });
  }

  return (
    <BottomSheet label={`Day ${index + 1} places`} onClose={onClose}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "6px 18px 12px", borderBottom: "1px solid var(--hairline)", flex: "none" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mono-caption">Day {index + 1} · changes save as you go</div>
          <div className="serif-place" style={{ fontSize: 21, lineHeight: 1.2, color: "var(--text-primary)", marginTop: 2 }}>
            {tripDayTitle(index + 1, trip.startDate, trip.endDate)}
          </div>
        </div>
        <button type="button" onClick={onClose} style={{ font: "600 13.5px var(--font-sans)", color: "var(--accent)", paddingTop: 4 }}>
          Done
        </button>
      </div>

      <div className="screen-scroll" style={{ padding: "14px 18px 20px", display: "flex", flexDirection: "column", gap: 18 }}>
        {error ? (
          <div role="alert" style={{ font: "500 12.5px var(--font-sans)", color: "var(--warn)" }}>
            {error}
          </div>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <PlaceChips
            label="Staying in"
            hint="where you sleep that night · tap again to clear"
            names={names}
            chosen={day.stay ? [day.stay] : []}
            kind="stay"
            onPick={(name) => save(withStay(day, samePlace(day.stay, name) ? null : name))}
          />
          {!day.stay && yesterday.stay ? (
            <button type="button" onClick={() => save(withStay(day, yesterday.stay))} style={linkStyle}>
              Same as Day {index}: {yesterday.stay}
            </button>
          ) : null}
          {movedFrom ? <Note>Day {index} was in {movedFrom}, so this is a moving day.</Note> : null}
        </div>

        <PlaceChips
          label="Day trips"
          hint="there and back the same day, in the order you go"
          names={names}
          chosen={day.visits}
          kind="visit"
          isDisabled={(name) => (samePlace(day.stay, name) ? "You’re staying here" : null)}
          onPick={(name) => save(includesPlace(day.visits, name) ? withoutVisit(day, name) : withVisit(day, name))}
        />

        {onCalendar.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <span className="mono-caption">On the calendar this day</span>
            <ul aria-label="On the calendar this day" style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
              {onCalendar.map((item, i) => (
                <li key={`${item.title}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 11px", borderTop: i ? "1px solid var(--hairline)" : "none" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", font: "500 12.5px var(--font-sans)", color: "var(--text-primary)" }}>{item.title}</span>
                    <span className="mono-data-sm" style={{ color: "var(--text-muted)", letterSpacing: 0 }}>{item.region}</span>
                  </span>
                  {includesPlace(listed, item.region) ? (
                    <span className="mono-caption" style={{ color: "var(--geo)" }}>Listed</span>
                  ) : (
                    <button type="button" onClick={() => save(withVisit(day, item.region))} style={{ font: "600 12px var(--font-sans)", color: "var(--accent)" }}>
                      Add {item.region} as a day trip
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--hairline)", paddingTop: 12 }}>
          <button type="button" onClick={clearDay} disabled={!isSet(day)} style={{ font: "600 12.5px var(--font-sans)", color: "var(--warn)", opacity: isSet(day) ? 1 : 0.4 }}>
            Clear this day
          </button>
          <span style={{ display: "flex", gap: 16 }}>
            {index > 0 ? (
              <button type="button" onClick={() => onStep(index - 1)} style={linkStyle}>
                ‹ Day {index}
              </button>
            ) : null}
            {index < dates.length - 1 ? (
              <button type="button" onClick={() => onStep(index + 1)} style={linkStyle}>
                Day {index + 2} ›
              </button>
            ) : null}
          </span>
        </div>
      </div>
    </BottomSheet>
  );
}

function Note({ children }) {
  return (
    <div style={{ font: "400 12px/1.45 var(--font-sans)", color: "var(--text-secondary)", padding: "8px 10px", borderRadius: "var(--radius-md)", background: "var(--surface-inset)" }}>
      {children}
    </div>
  );
}

const linkStyle = { alignSelf: "flex-start", font: "600 12.5px var(--font-sans)", color: "var(--accent)" };
