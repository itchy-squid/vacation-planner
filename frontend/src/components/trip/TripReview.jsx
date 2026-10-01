import Button from "../core/Button";
import { clockLabel } from "../../lib/planTime";
import { formatDuration } from "../../lib/format";
import { lateMessage, rideTitle, stopLetter } from "../../lib/tripPlan";
import { formatMoney } from "../../data/expenses";
import ModeIcon from "./ModeIcon";
import TripNote from "./TripNote";

const ROLE_COLOURS = { new: "var(--accent)", anchor: "var(--geo)", lodging: "var(--surface-inverse)" };

/**
 * The last step before a trip goes to a vote: its name, the block it
 * claims (stops and rides with their times; where it starts and ends
 * greyed, since they aren't part of it), what it sweeps up, and why.
 *
 *   trip      buildTrip(...)
 *   choices   the chosen way of making each ride (lib/routes.js readRoute + mode)
 *   planTitles  plan id -> title, to name what the block captures
 *   when        "Tue, Oct 20 · 12:15–16:22", with onChangeStart to go back and move it
 *   money       lib/tripPlan.js tripMoney(...), or null when the viewer can't see every cost
 *   audience    who it's for ("Mei & Jae"), or null for everyone
 *   sendLabel   "Send to vote", "Add as another set", "Save changes"
 *   onDraft     null where there's no draft to keep (a set in a running vote)
 *   footnote    what happens next, in a sentence
 */
export default function TripReview({
  trip,
  choices,
  dayIndex,
  planTitles,
  name,
  onName,
  why,
  onWhy,
  sending,
  error,
  onSend,
  onDraft,
  onBack,
  when,
  onChangeStart,
  money,
  audience = null,
  sendLabel = "Send to vote",
  footnote,
}) {
  const captured = trip.captured.map((id) => planTitles[id]).filter(Boolean);
  const others = trip.clashes.filter((c) => !c.locked).map((c) => c.title);

  return (
    <div className="screen">
      <div style={{ flex: "none", display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "20px 16px 12px", borderBottom: "1px solid var(--hairline)" }}>
        <button type="button" onClick={onBack} disabled={sending} style={{ justifySelf: "start", font: "500 13px var(--font-sans)", color: "var(--accent)" }}>
          ‹ Route
        </button>
        <span className="serif-place" style={{ fontSize: 18 }}>
          Review
        </span>
        <span className="mono-caption" style={{ justifySelf: "end" }}>
          Day {dayIndex}
        </span>
      </div>

      <div className="screen-scroll" style={{ padding: "12px 16px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
        {error ? (
          <div role="alert" style={{ font: "500 12.5px var(--font-sans)", color: "var(--warn)" }}>
            {error}
          </div>
        ) : null}

        <Card>
          <label className="mono-caption" htmlFor="trip-name">
            Name this proposal
          </label>
          <input
            id="trip-name"
            className="serif-place"
            value={name}
            maxLength={200}
            onChange={(e) => onName(e.target.value)}
            style={{ fontSize: 20, border: 0, borderBottom: "2px solid var(--accent)", padding: "4px 0 6px", background: "transparent", color: "var(--text-primary)" }}
          />
        </Card>

        <Card>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span className="mono-caption">Starts</span>
              <span style={{ font: "600 15px var(--font-sans)", color: "var(--text-primary)" }}>{when}</span>
              {audience ? <span style={{ font: "400 12px var(--font-sans)", color: "var(--text-secondary)" }}>For {audience}</span> : null}
            </span>
            {onChangeStart ? (
              <button type="button" onClick={onChangeStart} disabled={sending} style={{ font: "600 12.5px var(--font-sans)", color: "var(--accent)", minHeight: 40 }}>
                Change
              </button>
            ) : null}
          </div>
        </Card>

        <Card>
          <span className="mono-caption" style={{ color: "var(--accent)" }}>
            Proposed block · {clockLabel(trip.windowStart)}–{clockLabel(trip.windowEnd)} · {formatDuration(trip.windowEnd - trip.windowStart)}
          </span>
          <ol aria-label="What's in the block" style={{ listStyle: "none" }}>
            {trip.seq.map((it, i) => (
              <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderTop: i ? "1px solid var(--hairline)" : "none", opacity: it.inBlock ? 1 : 0.5 }}>
                <span className="mono-data-sm" style={{ width: 40, flex: "none", paddingTop: 3, letterSpacing: 0, color: "var(--text-muted)" }}>
                  {clockLabel(it.start)}
                </span>
                {it.kind === "stop" ? (
                  <span
                    aria-hidden="true"
                    style={{
                      width: 22,
                      height: 22,
                      flex: "none",
                      borderRadius: "50%",
                      background: it.stop.pin.located === false ? "var(--surface-card)" : ROLE_COLOURS[it.stop.role],
                      border: it.stop.pin.located === false ? "1.5px dashed var(--text-muted)" : "none",
                      color: it.stop.pin.located === false ? "var(--text-secondary)" : "#fff",
                      font: "700 11px var(--font-sans)",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    {stopLetter(trip, it.stop)}
                  </span>
                ) : (
                  <span aria-hidden="true" style={{ width: 22, flex: "none", display: "grid", placeItems: "center", color: "var(--accent)", paddingTop: 3 }}>
                    <ModeIcon mode={choices[it.index]?.mode} />
                  </span>
                )}
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ font: "600 13.5px var(--font-sans)", color: "var(--text-primary)" }}>
                    {it.kind === "stop" ? it.stop.pin.title : rideTitle(choices[it.index]?.mode, it.to)}
                  </span>
                  <span className="mono-data-sm" style={{ color: "var(--text-muted)", letterSpacing: 0 }}>
                    {stopMeta(it, choices, trip)}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--hairline)", paddingTop: 10 }}>
            <span className="mono-caption">
              {plural(trip.stops.filter((s) => s.inBlock).length, "stop")} · {plural(trip.legs.length, "ride")}
            </span>
            {money ? (
              <span className="mono-data-sm" style={{ letterSpacing: 0, textAlign: "right" }}>
                {money.totalCents ? `About ${formatMoney(money.perHeadCents)} each · ${formatMoney(money.totalCents)} for ${money.headcount}` : "No costs yet"}
                {money.unknownFares ? " + fares not known" : ""}
              </span>
            ) : null}
          </div>
        </Card>

        {captured.length ? (
          <TripNote tone="geo">
            {captured.join(", ")} {captured.length === 1 ? "is" : "are"} already on the calendar, so {captured.length === 1 ? "it moves" : "they move"} into this block at the same
            time. If the block loses the vote, {captured.length === 1 ? "it stays" : "they stay"} exactly where {captured.length === 1 ? "it is" : "they are"}.
          </TripNote>
        ) : null}
        {others.length ? <TripNote tone="warn">Overlaps {others.join(" and ")}. What’s on the board now joins the vote as set A.</TripNote> : null}
        {trip.late.length ? <TripNote tone="warn">{lateMessage(trip.late[0])}</TripNote> : null}

        <Card>
          <label className="mono-caption" htmlFor="trip-why">
            Why (optional)
          </label>
          <textarea
            id="trip-why"
            rows={2}
            value={why}
            maxLength={2000}
            onChange={(e) => onWhy(e.target.value)}
            placeholder="What makes this worth the trip?"
            style={{ border: 0, resize: "none", font: "400 13px/1.5 var(--font-sans)", color: "var(--text-primary)", background: "transparent" }}
          />
        </Card>

        <div style={{ font: "400 12px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>
          {footnote ?? `Goes to a vote. The block shows as proposed on Day ${dayIndex} until the trip owner picks. Rides with a fare reach Expenses once it’s on the board.`}
        </div>
      </div>

      <div style={{ flex: "none", display: "flex", gap: 10, padding: "12px 16px 22px", borderTop: "1px solid var(--hairline)", background: "var(--surface-card)" }}>
        {onDraft ? (
          <Button variant="secondary" fullWidth={false} onClick={onDraft} disabled={sending} style={{ padding: "0 16px", whiteSpace: "nowrap" }}>
            Save draft
          </Button>
        ) : null}
        <Button variant="accent" onClick={onSend} disabled={sending || !name.trim()}>
          {sending ? "Sending…" : sendLabel}
        </Button>
      </div>
    </div>
  );
}

function stopMeta(it, choices, trip) {
  if (it.kind === "leg") {
    const choice = choices[it.index];
    return [formatDuration(it.minutes), choice?.summary].filter(Boolean).join(" · ");
  }
  if (!it.inBlock) return it.stop.index === 0 ? "Leave from here" : "Arrive";
  if (it.stop.role === "anchor") return `Already on the calendar · ${formatDuration(it.minutes)}`;
  if (it.stop.pin.located === false) return `Where you already are · ${formatDuration(it.minutes)}${it.end === trip.windowEnd ? " · ends the block" : ""}`;
  return `Visit · ${formatDuration(it.minutes)}${it.end === trip.windowEnd ? " · ends the block" : ""}`;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function Card({ children }) {
  return (
    <div style={{ background: "var(--surface-card)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
      {children}
    </div>
  );
}
