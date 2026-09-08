import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import PhotoPlaceholder from "../components/core/PhotoPlaceholder";
import { TextArea } from "../components/forms/TextField";
import { textFieldStyle } from "../components/forms/TextField";
import Stepper from "../components/forms/Stepper";
import AvailabilityGrid from "../components/planner/AvailabilityGrid";
import MapPlaceholder from "../components/planner/MapPlaceholder";
import { usePlannerState, usePlannerDispatch } from "../state/PlannerContext";
import { api } from "../lib/api";
import { fmtMin } from "../data/derive";
import { getTripDays } from "../data/trip";
import { dayIndexAndBandForPlan, isoForDayMinute } from "../lib/planTime";
import HomeButton from "../components/core/HomeButton";

// Screen 6 — "change one stop's details, and see when it can happen."
// Handoff README screen 6. Edits are immediate (no local draft): every
// field change dispatches straight into shared state, matching
// "Interactions & behaviour → Editing" in the handoff. "Where this pin is
// currently placed" used to read the old hardcoded day5Block/lockedSetKey;
// now it's a plain scan over state.plans (any day, any status) via
// lib/planTime.js dayIndexAndBandForPlan — see docs/features/scheduling-
// feature-spec.md.
export default function EditVisit() {
  const navigate = useNavigate();
  // Pin ids are plain integers now (see backend/app/models.py), but a URL
  // segment always comes back as a string — convert once here so every
  // comparison/lookup below (state.pins[pinId], plan item scans) is a
  // real number-to-number match.
  const pinId = Number(useParams().pinId);
  const [searchParams] = useSearchParams();
  const from = searchParams.get("from") || "schedule";
  const state = usePlannerState();
  const dispatch = usePlannerDispatch();
  const pin = state.pins[pinId];

  const [commentCount, setCommentCount] = useState(null);
  const [durationSyncNote, setDurationSyncNote] = useState("");
  useEffect(() => {
    let cancelled = false;
    api
      .listPinComments(pinId)
      .then((comments) => {
        if (!cancelled) setCommentCount(comments.length);
      })
      .catch(() => {
        if (!cancelled) setCommentCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pinId]);

  if (!pin) {
    return (
      <div className="screen" style={{ padding: 24 }}>
        <p>Pin not found.</p>
        <button onClick={() => navigate(-1)}>‹ Back</button>
        <div style={{ marginTop: 12 }}>
          <button onClick={() => navigate("/")} style={{ font: "500 13px var(--font-sans)", color: "var(--accent)" }}>Trips home</button>
        </div>
      </div>
    );
  }

  const rule = pin.availabilityRule;
  // Real trip dates (pages/TripSettings.jsx), same source
  // pages/DaySchedule.jsx already derives its day strip from, so the
  // "when this one can happen" grid tracks the trip's actual length and
  // start date instead of always showing a fixed calendar.
  const tripDays = getTripDays(state.trip.startDate, state.trip.endDate);
  const who = state.contributors.find((c) => c.id === pin.who);

  // Whichever Plan currently carries this pin, if any — a pin can only be
  // in one active plan at a time. Drives both the "placed" dot on the
  // availability grid and the contested-plan footnote below.
  const placingPlan = state.plans.find((p) => p.items.some((it) => it.pinId === pinId));
  const placedDayIndexAndBand = placingPlan ? dayIndexAndBandForPlan(placingPlan, state.trip.startDate) : null;
  const placedDayBand = placedDayIndexAndBand ? `${placedDayIndexAndBand.dayIndex}-${placedDayIndexAndBand.band}` : null;

  function patch(fields) {
    dispatch({ type: "PATCH_PIN", id: pinId, fields });
  }

  // Duration is the same field on both screens (see
  // components/planner/PlanDetailsSheet.jsx's "Duration" stepper, which
  // does this sync the other way around): changing it here also resizes
  // this pin's calendar slot, if it currently has one, so the two never
  // drift apart. Only possible while that plan is placed/pencilled — a
  // contested/locked plan's window can't be resized (spec "Moving /
  // unplacing"); its slack just changes instead once this pin's new
  // duration is next fetched.
  async function changeDuration(nextDur) {
    const clamped = Math.max(15, nextDur);
    patch({ dur: clamped });
    setDurationSyncNote("");
    if (
      placingPlan &&
      (placingPlan.status === "placed" || placingPlan.status === "pencilled") &&
      placingPlan.items.length === 1 &&
      placingPlan.startDt &&
      placedDayIndexAndBand
    ) {
      const endsAt = isoForDayMinute(state.trip.startDate, placedDayIndexAndBand.dayIndex, placingPlan.startDt.minuteOfDay + clamped);
      const result = await dispatch({ type: "MOVE_PLAN", planId: placingPlan.id, startsAt: placingPlan.startsAt, endsAt });
      if (!result.ok) {
        setDurationSyncNote("Its scheduled slot is already at capacity there — the calendar didn't grow to match.");
      }
    }
  }

  function goBack() {
    const base = `/trips/${state.trip.id}`;
    if (from === "compare" && placingPlan?.contestId) navigate(`${base}/contests/${placingPlan.contestId}`);
    else if (from === "board") navigate(`${base}/board`);
    else if (from === "itinerary") navigate(`${base}/itinerary`);
    else navigate(`${base}/schedule/${placedDayIndexAndBand?.dayIndex ?? 1}`);
  }

  const commentLabel = commentCount ? `${commentCount} comment${commentCount === 1 ? "" : "s"}` : "Comment";
  const inContestedPlan = placingPlan?.status === "contested";
  const footnote = inContestedPlan
    ? `Changes recompute this plan's totals. All ${state.contributors.length} contributors see the edit.`
    : `All ${state.contributors.length} contributors see the edit.`;

  return (
    <div className="screen">
      <div className="screen-scroll" style={{ paddingBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 16px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <HomeButton size={28} />
            <button onClick={goBack} style={{ font: "500 13px var(--font-sans)", color: "var(--accent)" }}>‹ Cancel</button>
          </div>
          <span className="mono-caption">Edit visit</span>
          <button onClick={goBack} style={{ font: "600 13px var(--font-sans)", color: "var(--text-primary)" }}>Save</button>
        </div>

        <PhotoPlaceholder height={150} label="photo placeholder">
          <div style={{ marginLeft: "auto", marginRight: 14, marginBottom: 10 }}>
            <span style={{ background: "rgba(255,255,255,.94)", borderRadius: 999, padding: "5px 10px", font: "600 10px var(--font-sans)", color: "var(--stone-700)" }}>Replace</span>
          </div>
        </PhotoPlaceholder>

        <div style={{ padding: "16px 16px 0", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div className="mono-caption">Title</div>
            <input value={pin.title} onChange={(e) => patch({ title: e.target.value })} style={{ marginTop: 6, ...textFieldStyle({ weight: 600, size: 15 }) }} />
          </div>

          <div style={{ background: "var(--surface-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", overflow: "hidden" }}>
            <MapPlaceholder height={96} label="">
              <div
                style={{
                  position: "absolute",
                  top: 34,
                  left: "50%",
                  marginLeft: -11,
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: "var(--accent)",
                  border: "3px solid #fff",
                  boxShadow: "0 2px 8px rgba(0,0,0,.2)",
                }}
              />
            </MapPlaceholder>
            <div style={{ padding: "11px 13px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ font: "600 12.5px var(--font-sans)", color: "var(--text-primary)" }}>{pin.place}</div>
                <div className="mono-data-sm" style={{ color: "var(--text-muted)", marginTop: 2 }}>{pin.coords}</div>
              </div>
              <span style={{ font: "600 11.5px var(--font-sans)", color: "var(--accent)" }}>Move pin</span>
            </div>
          </div>

          <div style={{ background: "var(--surface-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", padding: "12px 13px 13px" }}>
            <AvailabilityGrid
              pinId={pinId}
              rule={rule.days ? rule : null}
              overrides={state.overrides}
              placedDayBand={placedDayBand}
              days={tripDays}
              onToggle={(day, band) => dispatch({ type: "TOGGLE_OVERRIDE", pinId, day, band })}
            />
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <Stepper
              label="Duration"
              valueLabel={fmtMin(pin.dur)}
              onDown={() => changeDuration(pin.dur - 15)}
              onUp={() => changeDuration(pin.dur + 15)}
            />
            <div style={{ flex: 1 }}>
              <div className="mono-caption">Cost each</div>
              <div style={{ marginTop: 6, display: "flex", alignItems: "center", background: "var(--surface-card)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-lg)", height: 46, padding: "0 13px" }}>
                <span style={{ font: "500 14px var(--font-sans)", color: "var(--text-muted)", marginRight: 4 }}>$</span>
                <input
                  value={pin.cost}
                  onChange={(e) => {
                    const v = parseInt(e.target.value.replace(/[^0-9]/g, ""), 10);
                    patch({ cost: Number.isNaN(v) ? 0 : v });
                  }}
                  inputMode="numeric"
                  style={{ flex: 1, minWidth: 0, border: "none", outline: "none", fontSize: 14, fontWeight: 600, color: "var(--text-primary)", background: "transparent" }}
                />
              </div>
            </div>
          </div>

          {durationSyncNote && (
            <div style={{ font: "500 11px var(--font-sans)", color: "var(--warn, #a15c1a)" }}>{durationSyncNote}</div>
          )}

          <TextArea label="Notes for the group" value={pin.notes} onChange={(e) => patch({ notes: e.target.value })} />

          <div>
            <div className="mono-caption">Source link</div>
            <input value={pin.link} onChange={(e) => patch({ link: e.target.value })} style={{ marginTop: 6, ...textFieldStyle({ mono: true, size: 12.5 }) }} />
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 13px", background: "var(--surface-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: who?.tint ?? "var(--who-1)", display: "flex", alignItems: "center", justifyContent: "center", font: "600 10px var(--font-sans)", color: "var(--stone-700)" }}>
                {who?.initial ?? pin.whoName?.[0]?.toUpperCase() ?? "?"}
              </div>
              <div>
                <div style={{ font: "500 12px var(--font-sans)", color: "var(--text-primary)" }}>{pin.whoName}</div>
                <div className="mono-data-sm" style={{ color: "var(--text-muted)" }}>pinned it · {pin.addedAgo}</div>
              </div>
            </div>
            <span style={{ font: "400 11.5px var(--font-sans)", color: "var(--accent)" }}>{commentLabel}</span>
          </div>

          <button
            onClick={goBack}
            style={{ height: 48, borderRadius: "var(--radius-lg)", background: "var(--surface-inverse)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", font: "600 14px var(--font-sans)" }}
          >
            Save changes
          </button>
          <div style={{ textAlign: "center", font: "400 11px var(--font-sans)", color: "var(--text-muted)", paddingBottom: 8 }}>{footnote}</div>
        </div>
      </div>
    </div>
  );
}
