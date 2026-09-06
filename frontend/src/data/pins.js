// NOTE: no longer imported anywhere in the app — pins now come from the
// real backend (see state/PlannerContext.jsx, which fetches and normalizes
// them). Kept only as a readable record of the original sample content this
// project shipped with; backend/app/seed.py has its own copy of the same
// values for populating the database, independent of this file.

// Sample content for the demo trip: Taiwan, Oct 3-10, Taipei + Xiaoliuqiu +
// Hualien + Tainan, six contributors (Mei, Jae, Ana, Lin, +2). The seven
// Xiaoliuqiu pins and their availability rules are lifted verbatim from the
// interactive prototype (Vacation Planner Prototype.dc.html) — that file is
// "the authority for behaviour" per the design handoff, so the Day 5
// contested-block flow reproduces its exact numbers.

// Availability rules: which days (trip day-of-month numbers) and bands
// (AM/PM/EVE) a pin can be visited on, and why. A pin with no rule is
// treated as available every day/band (nothing ties it down yet).
export const BANDS = ["AM", "PM", "EVE"];

export const AVAILABILITY_RULES = {
  p1: { days: [7, 8], bands: ["PM"], why: ["On Xiaoliuqiu only: Oct 7–8", "Needs low tide — 13:00–16:00"] },
  p2: { days: [7, 8], bands: ["AM", "PM"], why: ["On Xiaoliuqiu only: Oct 7–8", "Snorkel boats stop at 16:00"] },
  p3: { days: [7, 8], bands: ["AM", "PM"], why: ["On Xiaoliuqiu only: Oct 7–8", "Closes 17:00 on weekdays"] },
  p4: { days: [7, 8], bands: ["AM", "PM"], why: ["On Xiaoliuqiu only: Oct 7–8", "Unlit trail — daylight only"] },
  p5: { days: [7, 8], bands: ["PM", "EVE"], why: ["On Xiaoliuqiu only: Oct 7–8", "Sunset side — afternoon or later"] },
  p6: { days: [7, 8], bands: ["AM"], why: ["On Xiaoliuqiu only: Oct 7–8", "Fish market winds down by 10:00"] },
  p7: { days: [7, 8], bands: ["AM", "PM"], why: ["On Xiaoliuqiu only: Oct 7–8", "Ticket office 08:00–16:30"] },
};

// cx/cy are prototype map-surface pixel coordinates against a ~380px-wide
// canvas (see design_system readme: "In production, replace them with
// lat/lng and let Google Maps project them"). Kept as-is for the placeholder
// map since no Maps API key is wired up yet in this pass.
export const PINS = [
  // ---- Xiaoliuqiu: the seven pins the compare/edit flow is built around ----
  { id: "p1", title: "Vase Rock", short: "Vase Rock", place: "Xiaoliuqiu, Pingtung", region: "Xiaoliuqiu", coords: "22.3487° N, 120.3712° E", cx: 62, cy: 152, dur: 50, cost: 0, who: "mei", whoName: "Mei", addedAgo: "3 weeks ago", comments: 1, notes: "Best at low tide — 14:10 that day.", link: "maps.app/vase-rock", tags: ["outdoors", "swim"], set: "A" },
  { id: "p2", title: "Meirendong tide pools", short: "Tide pools", place: "Meirendong, Xiaoliuqiu", region: "Xiaoliuqiu", coords: "22.3391° N, 120.3688° E", cx: 176, cy: 128, dur: 70, cost: 5, who: "jae", whoName: "Jae", addedAgo: "3 weeks ago", comments: 4, notes: "Reef shoes needed. Jae has two spare pairs.", link: "maps.app/meirendong", tags: ["swim", "outdoors"], set: "A" },
  { id: "p3", title: "Shaved ice, Benfu St", short: "Shaved ice", place: "Benfu Street, Xiaoliuqiu", region: "Xiaoliuqiu", coords: "22.3442° N, 120.3801° E", cx: 300, cy: 196, dur: 30, cost: 4, who: "lin", whoName: "Lin", addedAgo: "9 days ago", comments: 0, notes: "Closes at 17:00 on weekdays.", link: "instagram.com/benfu-ice", tags: ["food"], set: "A" },
  { id: "p4", title: "Wild Boy trail loop", short: "Wild Boy", place: "Xiaoliuqiu west coast", region: "Xiaoliuqiu", coords: "22.3355° N, 120.3610° E", cx: 96, cy: 258, dur: 80, cost: 4, who: "lin", whoName: "Lin", addedAgo: "2 weeks ago", comments: 2, notes: "Shaded most of the way; last stretch is exposed.", link: "maps.app/wild-boy-trail", tags: ["hike", "outdoors"], set: "B" },
  { id: "p5", title: "Beach at Geban Bay", short: "Geban Bay", place: "Geban Bay, Xiaoliuqiu", region: "Xiaoliuqiu", coords: "22.3298° N, 120.3745° E", cx: 262, cy: 292, dur: 65, cost: 0, who: "ana", whoName: "Ana", addedAgo: "2 weeks ago", comments: 1, notes: "Shade is gone after 15:30.", link: "maps.app/geban-bay", tags: ["swim", "sunset"], set: "B" },
  { id: "p6", title: "Sanfu fishing port", short: "Sanfu port", place: "Sanfu, Xiaoliuqiu", region: "Xiaoliuqiu", coords: "22.3521° N, 120.3777° E", cx: 322, cy: 116, dur: 40, cost: 0, who: "jae", whoName: "Jae", addedAgo: "5 days ago", comments: 0, notes: "", link: "maps.app/sanfu-port", tags: ["outdoors"], set: null },
  { id: "p7", title: "Black Dwarf cave", short: "Black Dwarf", place: "Southeast Xiaoliuqiu", region: "Xiaoliuqiu", coords: "22.3312° N, 120.3829° E", cx: 154, cy: 316, dur: 45, cost: 3, who: "mei", whoName: "Mei", addedAgo: "5 days ago", comments: 0, notes: "", link: "maps.app/black-dwarf", tags: ["rainy-day"], set: null },

  // ---- Taipei: the largest region on the board ----
  { id: "p8", title: "Elephant Mountain lookout", short: "Elephant Mtn", place: "Xinyi, Taipei", region: "Taipei", coords: "25.0270° N, 121.5703° E", cx: 90, cy: 60, dur: 90, cost: 0, who: "ana", whoName: "Ana", addedAgo: "1 month ago", comments: 2, notes: "Ana raised the heat — go before 09:00 or after 16:00.", link: "maps.app/elephant-mountain", tags: ["hike", "sunset"], set: null },
  { id: "p9", title: "Raohe Night Market", short: "Raohe Market", place: "Songshan, Taipei", region: "Taipei", coords: "25.0505° N, 121.5773° E", cx: 210, cy: 88, dur: 100, cost: 15, who: "jae", whoName: "Jae", addedAgo: "1 month ago", comments: 3, notes: "Pepper buns at the temple end of the street.", link: "maps.app/raohe-market", tags: ["food"], set: null },
  { id: "p10", title: "National Palace Museum", short: "Palace Museum", place: "Shilin, Taipei", region: "Taipei", coords: "25.1024° N, 121.5486° E", cx: 60, cy: 140, dur: 150, cost: 12, who: "mei", whoName: "Mei", addedAgo: "3 weeks ago", comments: 1, notes: "", link: "npm.gov.tw", tags: ["rainy-day"], set: null },
  { id: "p11", title: "Beitou hot springs", short: "Beitou springs", place: "Beitou, Taipei", region: "Taipei", coords: "25.1367° N, 121.5084° E", cx: 34, cy: 176, dur: 120, cost: 20, who: "lin", whoName: "Lin", addedAgo: "3 weeks ago", comments: 0, notes: "", link: "maps.app/beitou-hot-springs", tags: ["rainy-day"], set: null },
  { id: "p12", title: "Bopiliao Historic Block", short: "Bopiliao", place: "Wanhua, Taipei", region: "Taipei", coords: "25.0374° N, 121.5013° E", cx: 150, cy: 200, dur: 60, cost: 0, who: "ana", whoName: "Ana", addedAgo: "2 weeks ago", comments: 0, notes: "", link: "maps.app/bopiliao", tags: ["rainy-day"], set: null },
  { id: "p13", title: "Din Tai Fung, Xinyi", short: "Din Tai Fung", place: "Xinyi, Taipei", region: "Taipei", coords: "25.0339° N, 121.5645° E", cx: 260, cy: 150, dur: 75, cost: 25, who: "jae", whoName: "Jae", addedAgo: "2 weeks ago", comments: 5, notes: "Reservation opens 2 weeks out.", link: "maps.app/din-tai-fung-xinyi", tags: ["food"], set: null },
  { id: "p14", title: "Ximending street art", short: "Ximending", place: "Wanhua, Taipei", region: "Taipei", coords: "25.0421° N, 121.5079° E", cx: 190, cy: 240, dur: 90, cost: 5, who: "lin", whoName: "Lin", addedAgo: "10 days ago", comments: 1, notes: "", link: "maps.app/ximending", tags: ["kid-ok"], set: null },
  { id: "p15", title: "Yangmingshan sulphur vents", short: "Yangmingshan", place: "Beitou, Taipei", region: "Taipei", coords: "25.1590° N, 121.5480° E", cx: 100, cy: 100, dur: 130, cost: 0, who: "mei", whoName: "Mei", addedAgo: "10 days ago", comments: 0, notes: "Unlit trail — daylight only.", link: "maps.app/yangmingshan", tags: ["hike", "outdoors"], set: null },

  // ---- Hualien: the unfinished tail end of the trip ----
  { id: "p16", title: "Taroko Gorge trailhead", short: "Taroko Gorge", place: "Xiulin, Hualien", region: "Hualien", coords: "24.1584° N, 121.6244° E", cx: 80, cy: 70, dur: 180, cost: 0, who: "ana", whoName: "Ana", addedAgo: "3 weeks ago", comments: 2, notes: "Permit needed for the Zhuilu Old Trail spur.", link: "maps.app/taroko-gorge", tags: ["hike", "outdoors"], set: null },
  { id: "p17", title: "Qixingtan pebble beach", short: "Qixingtan", place: "Xincheng, Hualien", region: "Hualien", coords: "24.0453° N, 121.6403° E", cx: 220, cy: 120, dur: 60, cost: 0, who: "jae", whoName: "Jae", addedAgo: "2 weeks ago", comments: 0, notes: "", link: "maps.app/qixingtan", tags: ["swim", "sunset"], set: null },
  { id: "p18", title: "Dongdamen Night Market", short: "Dongdamen", place: "Hualien City", region: "Hualien", coords: "23.9769° N, 121.6069° E", cx: 150, cy: 180, dur: 90, cost: 12, who: "lin", whoName: "Lin", addedAgo: "2 weeks ago", comments: 1, notes: "", link: "maps.app/dongdamen-market", tags: ["food"], set: null },
  { id: "p19", title: "Liyu Lake bike loop", short: "Liyu Lake", place: "Shoufeng, Hualien", region: "Hualien", coords: "23.8956° N, 121.5497° E", cx: 60, cy: 230, dur: 100, cost: 6, who: "mei", whoName: "Mei", addedAgo: "9 days ago", comments: 0, notes: "", link: "maps.app/liyu-lake", tags: ["outdoors", "kid-ok"], set: null },

  // ---- Tainan: fewer pins, still ideation-stage ----
  { id: "p20", title: "Anping Old Fort", short: "Anping Fort", place: "Anping, Tainan", region: "Tainan", coords: "22.9976° N, 120.1616° E", cx: 100, cy: 60, dur: 80, cost: 8, who: "jae", whoName: "Jae", addedAgo: "1 month ago", comments: 0, notes: "", link: "maps.app/anping-fort", tags: ["rainy-day"], set: null },
  { id: "p21", title: "Shennong Street", short: "Shennong St", place: "West Central, Tainan", region: "Tainan", coords: "22.9958° N, 120.1985° E", cx: 200, cy: 100, dur: 70, cost: 0, who: "ana", whoName: "Ana", addedAgo: "3 weeks ago", comments: 1, notes: "", link: "maps.app/shennong-street", tags: ["kid-ok"], set: null },
  { id: "p22", title: "Chihkan Tower", short: "Chihkan Tower", place: "West Central, Tainan", region: "Tainan", coords: "22.9971° N, 120.2027° E", cx: 150, cy: 150, dur: 60, cost: 6, who: "lin", whoName: "Lin", addedAgo: "3 weeks ago", comments: 0, notes: "", link: "maps.app/chihkan-tower", tags: ["rainy-day"], set: null },
  { id: "p23", title: "Garden Night Market", short: "Garden Market", place: "North, Tainan", region: "Tainan", coords: "23.0129° N, 120.1993° E", cx: 260, cy: 130, dur: 100, cost: 10, who: "mei", whoName: "Mei", addedAgo: "2 weeks ago", comments: 2, notes: "Weekends only.", link: "maps.app/garden-night-market", tags: ["food"], set: null },
  { id: "p24", title: "Sicao Green Tunnel", short: "Green Tunnel", place: "Annan, Tainan", region: "Tainan", coords: "23.0447° N, 120.1289° E", cx: 90, cy: 200, dur: 50, cost: 9, who: "jae", whoName: "Jae", addedAgo: "10 days ago", comments: 0, notes: "", link: "maps.app/sicao-green-tunnel", tags: ["outdoors", "kid-ok"], set: null },
];

export function pinById(id) {
  return PINS.find((p) => p.id === id) ?? null;
}

export function pinsByRegion(region) {
  return PINS.filter((p) => p.region === region);
}

export const REGION_ORDER = ["Taipei", "Xiaoliuqiu", "Hualien", "Tainan"];

export function availabilityFor(pinId) {
  return AVAILABILITY_RULES[pinId] ?? { days: null, bands: null, why: [] };
}
