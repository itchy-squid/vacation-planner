import { TRIP_DAYS } from "./trip";

// Day 5 (Oct 7, Xiaoliuqiu) is "the core screen" per the handoff: the one
// contested block the compare/edit flow is built around. Times are minutes
// from midnight, matching the prototype's BLOCK_START = 780 (13:00).
export const CONTESTED_BLOCK = {
  dayIndex: 5,
  start: 780,
  end: 960, // 13:00-16:00, a 180-minute block
  region: "Xiaoliuqiu",
  competingPinIds: ["p1", "p2", "p3", "p4", "p5"], // pins carrying set: "A" | "B"
};

// Fixed blocks around the contested one on Day 5, exactly as in the
// prototype header/timeline.
export const DAY5_FIXED_BLOCKS = [
  { id: "d5-ferry", type: "placed", title: "Ferry to Xiaoliuqiu", start: 480, end: 555, meta: "Donggang" },
  { id: "d5-snorkel", type: "placed", title: "Turtle snorkel, Meirendong", start: 570, end: 720, meta: "$45" },
];

// Representative (non-authoritative) blocks for the other seven days, so
// the day strip and block-state legend both have something real to show.
// These are flavor content, not wired to the compare/edit flow.
export const OTHER_DAY_BLOCKS = {
  1: [
    { id: "d1-1", type: "placed", title: "Arrive Taipei · check in", start: 780, end: 840, meta: "Da'an" },
    { id: "d1-2", type: "placed", title: "Raohe Night Market", start: 1080, end: 1180, meta: "$15" },
  ],
  2: [
    { id: "d2-1", type: "placed", title: "Elephant Mountain lookout", start: 950, end: 1040, meta: "free" },
    { id: "d2-2", type: "pencilled", title: "Din Tai Fung, Xinyi", start: 1140, end: 1215, meta: "$25 · unconfirmed" },
    { id: "d2-3", type: "empty", start: 1230 },
  ],
  3: [
    { id: "d3-1", type: "locked", title: "National Palace Museum", start: 570, end: 720, meta: "$12 each" },
    { id: "d3-2", type: "placed", title: "Beitou hot springs", start: 900, end: 1020, meta: "$20" },
  ],
  4: [
    { id: "d4-1", type: "placed", title: "Ximending street art", start: 600, end: 690, meta: "$5" },
    { id: "d4-2", type: "empty", start: 780 },
  ],
  6: [
    { id: "d6-1", type: "pencilled", title: "Black Dwarf cave", start: 570, end: 615, meta: "$3 · unconfirmed" },
    { id: "d6-2", type: "empty", start: 720 },
  ],
  7: [
    { id: "d7-1", type: "placed", title: "Taroko Gorge trailhead", start: 480, end: 660, meta: "free" },
    { id: "d7-2", type: "empty", start: 780 },
  ],
  8: [{ id: "d8-1", type: "empty", start: 540 }],
};

// Real pins now come from the API keyed by backend UUID, not these mock
// ids — matched by title instead (stable sample content either way). See
// frontend/src/pages/DaySchedule.jsx for the lookup.
export const UNPLACED_TRAY_TITLES = [
  "Sanfu fishing port",
  "Black Dwarf cave",
  "Raohe Night Market",
  "Beitou hot springs",
  "Ximending street art",
  "Qixingtan pebble beach",
  "Liyu Lake bike loop",
  "Chihkan Tower",
  "Sicao Green Tunnel",
];

export function dayHeaderLabel(dayIndex) {
  const d = TRIP_DAYS[dayIndex - 1];
  const dow = d ? `${d.dow[0]}${d.dow.slice(1).toLowerCase()}` : "";
  return `Day ${dayIndex} · ${dow} Oct ${d?.n ?? ""}`;
}

export function blocksForDay(dayIndex) {
  if (dayIndex === CONTESTED_BLOCK.dayIndex) return DAY5_FIXED_BLOCKS;
  return OTHER_DAY_BLOCKS[dayIndex] ?? [];
}
