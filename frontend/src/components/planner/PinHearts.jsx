import AvatarStack from "./AvatarStack";
import HeartButton from "../core/HeartButton";

const SHOWN_FACES = 4;
const SHOWN_NAMES = 2;

// Who has hearted this idea, and your own heart, on the pin's screen
// (pages/EditVisit.jsx). The board's cards only have room for a count
// (components/planner/PinCard.jsx); this is where the names are.
//
//   heart:        usePinHeart(pin) from state/PlannerContext.jsx
//   contributors: the trip's members, to put faces and names to the ids
//   currentUserId: so your own heart reads "You"
export default function PinHearts({ title, heart, contributors, currentUserId }) {
  const byId = new Map(contributors.map((c) => [c.id, c]));
  // Yours first, then everyone else in the order they hearted it.
  const people = [...heart.heartedBy]
    .sort((a, b) => Number(b === currentUserId) - Number(a === currentUserId))
    .map((id) => byId.get(id))
    .filter(Boolean);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "8px 8px 8px 13px",
        background: "var(--surface-card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-xl)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        {people.length > 0 ? (
          <AvatarStack
            contributors={people.slice(0, SHOWN_FACES)}
            overflowCount={Math.max(0, people.length - SHOWN_FACES)}
            size={26}
          />
        ) : null}
        <div style={{ font: "400 12px/1.4 var(--font-sans)", color: "var(--text-secondary)", minWidth: 0 }}>
          {heartedLine(people, currentUserId, heart.canHeart)}
        </div>
      </div>
      <HeartButton
        title={title}
        count={heart.count}
        hearted={heart.hearted}
        canHeart={heart.canHeart}
        onToggle={heart.toggle}
        busy={heart.busy}
      />
    </div>
  );
}

// "You and Jae hearted this", "Mei, Jae and 3 others hearted this".
function heartedLine(people, currentUserId, canHeart) {
  if (people.length === 0) return canHeart ? "Heart this if you'd like to go" : "No hearts yet";
  const names = people.map((p) => (p.id === currentUserId ? "You" : p.name));
  const shown = names.slice(0, SHOWN_NAMES);
  const rest = names.length - shown.length;
  let who;
  if (rest > 0) who = `${shown.join(", ")} and ${rest} ${rest === 1 ? "other" : "others"}`;
  else if (shown.length === 2) who = `${shown[0]} and ${shown[1]}`;
  else who = shown[0];
  return `${who} hearted this`;
}
