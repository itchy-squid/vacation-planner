// Placeholder-map pixel positions. The backend deliberately doesn't store
// these (see Pin.lat/lng in backend/app/models.py — real geocoding isn't
// wired up yet, per design_system readme "Map provider"), so this stays a
// frontend-only presentation concern, same as before the API existed.
// Values are the compare screen's original hand-placed layout for the
// seven Xiaoliuqiu pins the Day 5 contested block is built around — the
// only pins actually rendered on a coordinate map in this pass (see
// CompareSets.jsx).
const XIAOLIUQIU_COMPARE_LAYOUT = {
  p1: { cx: 62, cy: 152 },
  p2: { cx: 176, cy: 128 },
  p3: { cx: 300, cy: 196 },
  p4: { cx: 96, cy: 258 },
  p5: { cx: 262, cy: 292 },
  p6: { cx: 322, cy: 116 },
  p7: { cx: 154, cy: 316 },
};

// Pins are keyed by their real backend id once loaded from the API, not
// the old mock's short ids ("p1"..."p7") — match on title instead, which
// is stable sample content either way.
const TITLE_TO_MOCK_ID = {
  "Vase Rock": "p1",
  "Meirendong tide pools": "p2",
  "Shaved ice, Benfu St": "p3",
  "Wild Boy trail loop": "p4",
  "Beach at Geban Bay": "p5",
  "Sanfu fishing port": "p6",
  "Black Dwarf cave": "p7",
};

export function coordsForPin(pin) {
  const mockId = TITLE_TO_MOCK_ID[pin.title];
  return mockId ? XIAOLIUQIU_COMPARE_LAYOUT[mockId] : { cx: 190, cy: 220 };
}
