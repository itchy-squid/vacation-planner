import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import PhotoPlaceholder from "../components/core/PhotoPlaceholder";
import Badge from "../components/core/Badge";
import Button from "../components/core/Button";
import RoleTag from "../components/core/RoleTag";
import { api } from "../lib/api";
import { ROLES } from "../lib/roles";
import { formatDateRange } from "../lib/format";
import { usePlannerDispatch, usePlannerState } from "../state/PlannerContext";

// /join/:token — where an invite link lands. Shows which trip it is, who
// owns it, and what the link's role can do, then adds the trip to the
// viewer's list on "Add to my trips". Signing in has already happened by
// the time this renders (main.jsx gates the whole app on it, and Easy
// Auth returns here afterwards).
//
// Someone already on the trip skips the question and goes straight in;
// the server leaves their role as it was either way.

export default function JoinTrip() {
  const { token } = useParams();
  const navigate = useNavigate();
  const dispatch = usePlannerDispatch();
  const { switchingTripId } = usePlannerState();
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | gone | error
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [joining, setJoining] = useState(false);
  // Set once "Add to my trips" is tapped, so a re-run of the preview
  // effect (the app's trip state changes under this screen as the join
  // lands) can't mistake the new membership for "already a member" and
  // redirect somewhere else.
  const joinStartedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    api
      .previewInvite(token)
      .then(async (data) => {
        if (cancelled || joinStartedRef.current) return;
        if (data.already_member) {
          // Already on it: open the trip instead of asking.
          await dispatch({ type: "OPEN_TRIP", tripId: data.trip_id });
          if (!cancelled) navigate(`/trips/${data.trip_id}/board`, { replace: true });
          return;
        }
        setPreview(data);
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        if (err.status === 404) {
          setStatus("gone");
        } else {
          setError(err.message);
          setStatus("error");
        }
      });
    api
      .me()
      .then((me) => {
        if (!cancelled) setEmail(me.email);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token, dispatch, navigate]);

  async function handleJoin() {
    if (joining) return;
    joinStartedRef.current = true;
    setJoining(true);
    const result = await dispatch({ type: "JOIN_TRIP", token });
    if (result.ok) {
      navigate("/", { replace: true, state: { joinedTripName: result.tripName } });
      return;
    }
    joinStartedRef.current = false;
    setJoining(false);
    if (result.gone) setStatus("gone");
    else setError(result.error || "Couldn't add this trip. Try again.");
  }

  if (status === "loading" || switchingTripId) {
    return (
      <div className="screen" style={{ alignItems: "center", justifyContent: "center", display: "flex" }}>
        <div className="mono-caption">Opening invite…</div>
      </div>
    );
  }

  if (status === "gone" || status === "error") {
    return (
      <div className="screen">
        <div
          className="screen-scroll"
          style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 16, padding: "0 28px", textAlign: "center" }}
        >
          <div className="mono-caption">Trip invite</div>
          <h1 style={{ font: "var(--type-title)", color: "var(--text-primary)" }}>
            {status === "gone" ? "This invite link doesn’t work anymore" : "Couldn’t open this invite"}
          </h1>
          <p style={{ font: "var(--type-body)", color: "var(--text-secondary)", maxWidth: "32ch", alignSelf: "center" }}>
            {status === "gone"
              ? "The trip owner may have turned it off. Ask them to send you a new one."
              : error}
          </p>
          <div style={{ display: "flex", justifyContent: "center", marginTop: 4 }}>
            <Button fullWidth={false} onClick={() => navigate("/", { replace: true })} style={{ padding: "0 24px" }}>
              Go to my trips
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const ownerName = preview.owner?.display_name ?? "Someone";
  const locations = preview.region_line ? ` · ${preview.region_line}` : "";

  return (
    <div className="screen">
      <div className="screen-scroll" style={{ paddingBottom: 28 }}>
        <div style={{ padding: "24px var(--gutter-text) 14px" }}>
          <div className="mono-caption">Trip invite</div>
          <h1 className="serif-place" style={{ font: "var(--type-display)", color: "var(--text-primary)", marginTop: 8 }}>
            {ownerName} invited you to {preview.trip_name}
          </h1>
        </div>

        <div style={{ padding: "0 var(--gutter-screen)", display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              borderRadius: "var(--radius-2xl)",
              border: "1px solid var(--hairline)",
              boxShadow: "var(--shadow-raised)",
              background: "var(--surface-card)",
              overflow: "hidden",
            }}
          >
            <PhotoPlaceholder height={132} label="">
              <div style={{ position: "absolute", bottom: 10, right: 10 }}>
                <Badge>{preview.phase === "ideation" ? "IDEATION" : "SCHEDULING"}</Badge>
              </div>
            </PhotoPlaceholder>
            <div style={{ padding: "16px 18px 18px" }}>
              <div className="serif-place" style={{ fontSize: 27, lineHeight: 1.15, color: "var(--text-primary)" }}>
                {preview.trip_name}
              </div>
              <div style={{ font: "400 13px var(--font-sans)", color: "var(--text-secondary)", marginTop: 4 }}>
                {formatDateRange(preview.start_date, preview.end_date)}
                {locations}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                <div
                  title={ownerName}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: preview.owner?.tint ?? "var(--who-1)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    font: "600 10px var(--font-sans)",
                    color: "var(--text-secondary)",
                  }}
                >
                  {preview.owner?.initial ?? "?"}
                </div>
                <span style={{ font: "400 12px var(--font-sans)", color: "var(--text-muted)" }}>
                  {ownerName}&rsquo;s trip · {preview.member_count} planning
                </span>
              </div>
            </div>
          </div>

          <div
            style={{
              background: "var(--surface-card)",
              borderRadius: "var(--radius-xl)",
              border: "1px solid var(--hairline)",
              padding: "14px 16px 16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="mono-caption">You&rsquo;ll join as</span>
              <RoleTag role={preview.role} />
            </div>
            <ul style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 12 }}>
              {(ROLES[preview.role]?.joinPoints ?? ROLES.reader.joinPoints).map(([ok, text]) => (
                <li
                  key={text}
                  style={{
                    display: "flex",
                    gap: 9,
                    alignItems: "flex-start",
                    font: "400 13px/1.5 var(--font-sans)",
                    color: ok ? "var(--text-primary)" : "var(--text-secondary)",
                  }}
                >
                  {ok ? <CheckGlyph /> : <DashGlyph />}
                  <span>{text.replace("the owner", ownerName)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div style={{ padding: "20px var(--gutter-screen) 0", display: "flex", flexDirection: "column", gap: 4 }}>
          {error ? (
            <div style={{ font: "500 12.5px var(--font-sans)", color: "#b3423a", paddingBottom: 8 }}>{error}</div>
          ) : null}
          <Button onClick={handleJoin} disabled={joining}>
            {joining ? "Adding…" : "Add to my trips"}
          </Button>
          <button
            type="button"
            className="hit-target"
            onClick={() => navigate("/", { replace: true })}
            style={{ height: 44, font: "500 13px var(--font-sans)", color: "var(--text-secondary)" }}
          >
            Not now
          </button>
        </div>
        {email ? (
          <div style={{ padding: "6px 20px 0", textAlign: "center", font: "var(--type-caption)", color: "var(--text-muted)" }}>
            Signed in as {email}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CheckGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--geo)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", marginTop: 3 }} aria-hidden="true">
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  );
}

function DashGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--text-faint)" strokeWidth="2.2" strokeLinecap="round" style={{ flex: "none", marginTop: 3 }} aria-hidden="true">
      <path d="M4 8h8" />
    </svg>
  );
}
