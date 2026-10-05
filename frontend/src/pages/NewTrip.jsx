import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import TextField from "../components/forms/TextField";
import TripWhenFields from "../components/trip/TripWhenFields";
import Button from "../components/core/Button";
import HomeButton from "../components/core/HomeButton";
import WhoIsPlanning from "../components/newtrip/WhoIsPlanning";
import { usePlannerDispatch } from "../state/PlannerContext";
import { api } from "../lib/api";
import { resolvePayer } from "../lib/people";
import { whenFields, whenOf } from "../lib/tripWhen";

// Not one of the handoff README's numbered screens — added so the "+"
// affordance on Trips Home (screen 1) does something. Mirrors EditVisit's
// full-screen form pattern (header row + stacked fields + a bottom
// primary button) rather than a modal, to stay consistent with how this
// app does every other editing flow.
//
// Two steps when there's anyone to invite:
//   1. Name and when: its dates, or "Not sure yet" and roughly how long
//      (components/trip/TripWhenFields.jsx), so a trip can be planned by
//      day before the dates are known. Deliberately only those: a trip's regions are
//      derived from its pins (see PlannerContext's locationsLine), so
//      asking for them up front — before there are any pins — only
//      invites a hand-typed line that the derived one immediately
//      contradicts. The trip's own region_line stays editable in Trip
//      settings; the backend defaults it to "" when the payload omits it.
//   2. "Who's coming with you?" (components/newtrip/WhoIsPlanning.jsx):
//      people from past trips, each with a role, invited as the trip is
//      created, and past travelers without an account, listed with who
//      pays for them. Skippable. Someone who has never shared a trip has
//      no one to pick, so for them step 1 creates the trip straight away,
//      as it always did.
export default function NewTrip() {
  const navigate = useNavigate();
  const dispatch = usePlannerDispatch();

  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [when, setWhen] = useState(() => whenOf(null));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Everyone you've planned with (GET /api/people); null while loading.
  // If it can't be loaded, the form carries on as the one-step form it
  // used to be rather than holding up the trip.
  const [people, setPeople] = useState(null);
  // email -> { role, traveling } for everyone ticked on step 2.
  const [chosen, setChosen] = useState({});
  // People who came on your trips without an account (GET
  // /api/people/travelers); null while loading, [] if they can't be.
  const [pastTravelers, setPastTravelers] = useState(null);
  // key -> { paidBy } for each of them ticked on step 2.
  const [listed, setListed] = useState({});

  useEffect(() => {
    let cancelled = false;
    api
      .listPeople()
      .then((rows) => {
        if (!cancelled) setPeople(rows);
      })
      .catch(() => {
        if (!cancelled) setPeople([]);
      });
    api
      .listPastTravelers()
      .then((rows) => {
        if (!cancelled) setPastTravelers(rows);
      })
      .catch(() => {
        if (!cancelled) setPastTravelers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasStepTwo = people === null || people.length > 0 || (pastTravelers?.length ?? 0) > 0;
  const canContinue = name.trim().length > 0 && !submitting;

  async function create(withInvites) {
    if (!canContinue) return;
    setSubmitting(true);
    setError(null);
    const invitees = withInvites
      ? Object.entries(chosen).map(([email, { role, traveling }]) => ({ email, role, traveling }))
      : [];
    const byKey = new Map((pastTravelers ?? []).map((t) => [t.key, t]));
    const listedTravelers = withInvites
      ? Object.entries(listed)
          .filter(([key]) => byKey.has(key))
          .map(([key, { paidBy }]) => {
            const payer = resolvePayer(paidBy, chosen);
            return {
              name: byKey.get(key).name,
              paid_by_me: payer === "me",
              paid_by_email: payer === "me" ? null : payer,
            };
          })
      : [];
    try {
      const trip = await dispatch({
        type: "CREATE_TRIP",
        payload: {
          name: name.trim(),
          ...whenFields(when),
          invitees,
          listed: listedTravelers,
        },
      });
      const sent = invitees.length;
      const parts = [];
      if (sent) parts.push(`${sent} ${sent === 1 ? "invite" : "invites"} sent`);
      if (listedTravelers.length) parts.push(`${listedTravelers.length} listed`);
      navigate("/", {
        state: parts.length ? { toast: `${trip.name} created · ${parts.join(" · ")}` } : null,
      });
    } catch (err) {
      setError(err.message || "Couldn't create the trip. Try again.");
      setSubmitting(false);
    }
  }

  if (step === 2) {
    return (
      <WhoIsPlanning
        tripName={name.trim()}
        people={people}
        pastTravelers={pastTravelers}
        chosen={chosen}
        onChange={setChosen}
        listed={listed}
        onListedChange={setListed}
        onBack={() => setStep(1)}
        onSkip={() => create(false)}
        onCreate={() => create(true)}
        submitting={submitting}
        error={error}
      />
    );
  }

  function next() {
    if (!canContinue) return;
    if (hasStepTwo) setStep(2);
    else create(false);
  }

  return (
    <div className="screen">
      <div className="screen-scroll" style={{ paddingBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 16px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <HomeButton size={28} />
            <button onClick={() => navigate("/")} style={{ font: "500 13px var(--font-sans)", color: "var(--accent)" }}>‹ Cancel</button>
          </div>
          <span className="mono-caption">{hasStepTwo ? "New trip · 1 of 2" : "New trip"}</span>
          <button
            onClick={next}
            disabled={!canContinue}
            style={{ font: "600 13px var(--font-sans)", color: canContinue ? "var(--text-primary)" : "var(--text-muted)" }}
          >
            {hasStepTwo ? "Next" : submitting ? "Creating…" : "Create"}
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            next();
          }}
          style={{ padding: "16px 16px 0", display: "flex", flexDirection: "column", gap: 14 }}
        >
          <TextField
            label="Trip name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Peru"
            weight={600}
            size={15}
            autoFocus
          />
          <TripWhenFields value={when} onChange={setWhen} />

          {error ? (
            <div style={{ font: "500 12.5px var(--font-sans)", color: "#b3423a" }}>{error}</div>
          ) : null}

          <Button type="submit" variant="primary" disabled={!canContinue} style={{ marginTop: 4 }}>
            {hasStepTwo ? "Next: who’s coming" : submitting ? "Creating…" : "Create trip"}
          </Button>
          <div style={{ textAlign: "center", font: "400 11px var(--font-sans)", color: "var(--text-muted)", paddingBottom: 8 }}>
            {hasStepTwo
              ? "You’ll be the owner."
              : "You’ll be the owner — invite others once it’s open."}
          </div>
        </form>
      </div>
    </div>
  );
}
