import { useEffect, useMemo, useState } from "react";
import HomeTabBar from "../components/core/HomeTabBar";
import { Avatar } from "../components/sharing/PeopleList";
import { textFieldStyle } from "../components/forms/TextField";
import { api } from "../lib/api";
import { matchesQuery, sharedTripsLine, tripGroups } from "../lib/people";

// The People tab: everyone you've planned a trip with, built from shared
// trips rather than kept by hand (backend/app/routers/people.py), so there
// are no requests to send or accept. Most recently shared first. The same
// list is what a new trip's "Who's planning with you?" step picks from
// (pages/NewTrip.jsx).
export default function People() {
  const [people, setPeople] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [tripId, setTripId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listPeople()
      .then((rows) => {
        if (!cancelled) setPeople(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Couldn't load your people.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => tripGroups(people ?? []), [people]);
  const shown = (people ?? []).filter(
    (p) => matchesQuery(p, query) && (tripId === null || p.trips.some((t) => t.id === tripId))
  );

  return (
    <div className="screen">
      <div className="screen-scroll" style={{ paddingBottom: 24 }}>
        <div style={{ padding: "20px var(--gutter-text) 4px" }}>
          <h1 style={{ font: "700 26px var(--font-sans)", color: "var(--text-primary)" }}>People</h1>
          <div style={{ font: "400 12.5px var(--font-sans)", color: "var(--text-secondary)", marginTop: 4 }}>
            Everyone you&rsquo;ve planned a trip with. Only you see this list.
          </div>
        </div>

        {error ? (
          <div style={{ padding: "16px var(--gutter-text)", font: "500 12.5px var(--font-sans)", color: "var(--warn)" }}>
            {error}
          </div>
        ) : people === null ? (
          <div style={{ padding: "16px var(--gutter-text)", font: "400 13px var(--font-sans)", color: "var(--text-muted)" }}>
            Loading…
          </div>
        ) : people.length === 0 ? (
          <EmptyPeople />
        ) : (
          <>
            <div style={{ padding: "12px var(--gutter-screen) 0" }}>
              <input
                type="search"
                aria-label="Search people"
                placeholder="Search people"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={textFieldStyle()}
              />
            </div>

            {groups.length > 1 ? (
              <div
                role="group"
                aria-label="Filter by trip"
                style={{ display: "flex", gap: 8, padding: "12px var(--gutter-screen) 0", overflowX: "auto" }}
              >
                <FilterChip active={tripId === null} onClick={() => setTripId(null)}>
                  All · {people.length}
                </FilterChip>
                {groups.map((g) => (
                  <FilterChip key={g.id} active={tripId === g.id} onClick={() => setTripId(g.id)}>
                    {g.name}
                  </FilterChip>
                ))}
              </div>
            ) : null}

            <div style={{ padding: "16px var(--gutter-screen) 0" }}>
              {shown.length === 0 ? (
                <div style={{ font: "400 13px var(--font-sans)", color: "var(--text-muted)", padding: "8px 4px" }}>
                  No one matches.
                </div>
              ) : (
                <div
                  style={{
                    background: "var(--surface-card)",
                    borderRadius: "var(--radius-xl)",
                    border: "1px solid var(--hairline)",
                    overflow: "hidden",
                  }}
                >
                  {shown.map((p, i) => (
                    <div
                      key={p.email}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 14px",
                        minHeight: 58,
                        borderTop: i === 0 ? "none" : "1px solid var(--hairline)",
                      }}
                    >
                      <Avatar person={p} size={36} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ font: "600 14px var(--font-sans)", color: "var(--text-primary)" }}>{p.display_name}</div>
                        <div style={{ font: "400 12px var(--font-sans)", color: "var(--text-secondary)", marginTop: 2 }}>
                          {p.trips.length} {p.trips.length === 1 ? "trip" : "trips"} · {sharedTripsLine(p)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <HomeTabBar />
    </div>
  );
}

function FilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        flex: "none",
        height: 32,
        padding: "0 12px",
        borderRadius: "var(--radius-pill)",
        border: `1px solid ${active ? "var(--surface-inverse)" : "var(--border-strong)"}`,
        background: active ? "var(--surface-inverse)" : "var(--surface-card)",
        color: active ? "var(--text-on-dark)" : "var(--text-primary)",
        font: "600 12px var(--font-sans)",
      }}
    >
      {children}
    </button>
  );
}

function EmptyPeople() {
  return (
    <div style={{ padding: "16px var(--gutter-screen) 0" }}>
      <div
        style={{
          borderRadius: "var(--radius-2xl)",
          border: "1px dashed var(--border-strong)",
          background: "var(--surface-card)",
          padding: "30px 22px",
          textAlign: "center",
        }}
      >
        <div className="serif-place" style={{ fontSize: 21, color: "var(--text-primary)" }}>
          No one yet
        </div>
        <div style={{ font: "400 13px var(--font-sans)", color: "var(--text-secondary)", marginTop: 8 }}>
          When someone joins a trip you&rsquo;re on, they show up here, ready to invite to the next one.
        </div>
      </div>
    </div>
  );
}
