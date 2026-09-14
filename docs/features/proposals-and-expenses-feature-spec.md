# Proposals & Expenses — implementation spec

Source: `design_handoff_expenses_and_proposals` (favicon, Expenses page,
four-step proposal creation). This doc is the implementation contract; where
it differs from the handoff README, this doc wins, and the "Decisions
against the handoff" table below says why.

Companion to `docs/features/scheduling-feature-spec.md`, which this feature
amends in several places. Every amendment is called out inline as
**(amends scheduling spec)**.

## Overview

Three additions:

1. **Favicon** — a 16x16 site mark plus 32px and SVG versions.
2. **Expenses** — a new trip-scoped screen listing every *scheduled* item
   with its budgeted cost, shown per head and multiplied by a headcount,
   with the viewer's own share and the trip total.
3. **Proposal creation** — a four-step flow, entered from the Schedule
   day's add sheet, for proposing an alternative for a chosen *range of
   hours* rather
   than against one existing item. A proposal is a **block**: one time
   window holding several non-overlapping stops. It ends by handing the
   block to the contest/vote UI that already exists
   (`pages/CompareSets.jsx`).

The handoff was written without access to this repo ("the attached
`vacation-planner` folder did not come through"), so its chrome was
reconstructed from screenshots. Per its own instruction, **the real app
wins on chrome**: reuse the existing day strip, calendar grid, plan block,
tray, bottom nav, and `PlanDetailsSheet` rather than rebuilding from the
reference canvas. The handoff's colors, spacing, type, and copy are
authoritative for the *new* surfaces.

---

## Decisions against the handoff

| # | Handoff says | Conflict with what's built | Decision |
|---|---|---|---|
| 1 | A proposal claims a window that may cover several existing items | `POST /contests` takes a single `against_plan_id`; locking only deletes plans inside the contest, so a second overlapping plan would survive and collide with the winner | **Contest owns the window.** `Contest` gains `starts_at`/`ends_at`; every overlapping non-locked plan is captured into a single incumbent option |
| 2 | A pulled-in stop can be trimmed (`SHORTENED FROM 3H`) | Scheduling spec says a plan's Duration *is* the pin's `duration_minutes`, propagating both ways | **`PlanItem.duration_minutes` override** (nullable). A trim is local to that plan; the pin is untouched |
| 3 | Items carry `perHeadCost` and `heads` | Pins/travel items have one flat `cost_cents`, no heads | **`cost_cents` stays the total**; add `heads`. Per-head is derived — no migration, no drift |
| 4 | "until a majority picks a set" | The owner locks; nothing auto-resolves | **Majority is advisory.** Owner-lock stays; the UI surfaces a "majority reached" state and the copy is rewritten |
| 5 | Slack = window − sum(durations) | `derive.py` subtracts 12 min/hop; `CompareSets` sequences with a 10-min gap | **Drop moving time everywhere.** One definition, three call sites corrected |
| 6 | "Save draft" keeps a proposal private to its author | No such status; `pencilled` is public and occupies time | **New `draft` plan status**, author-visible only, excluded from overlap checks and from the grid |
| 7 | Gangway times are pinned and can't be moved or removed | No pinned concept | **Reuse `locked`**, with the "locked blocks the whole selection" rule relaxed (see §6.5) |
| 8 | Summary card has a category bar and legend | Pins carry free-form `tags`; travel items carry none | **Drop the category bar in v1.** Summary keeps Your share / Trip total |
| 9 | "4 TRAVELLERS" on Expenses, "6 PLANNERS" on the vote card | Contributors are one roster | **`Trip.traveller_count`** for costing, separate from contributors (the voting roster) |
| 10 | Trip currency code in the Expenses header | No currency anywhere; amounts render as bare `$` | **Hardcode `USD`** in v1 |

---

## 1. Data model

New and changed columns only; everything else in `backend/app/models.py`
is unchanged.

```
Trip
  + traveller_count: int | None      # people the trip is costed for.
                                     # NULL falls back to len(contributors).

Pin
  + heads: JSON list[int]  (default [])   # contributor ids sharing this cost.
                                          # [] means "everyone on the trip".
TravelItem
  + heads: JSON list[int]  (default [])   # same

Plan
  status: + "draft"                  # author-visible only (see §6.4)
  + rationale: text (default "")     # the "Why (optional)" shown to voters

PlanItem
  + duration_minutes: int | None     # override; NULL = read from pin/travel item
  + offset_minutes: int | None       # start, in minutes from plan.starts_at.
                                     # NULL = packed end to end in position order.

Contest
  + starts_at: datetime (tz-aware)   # the claimed window
  + ends_at:   datetime (tz-aware)
```

`PlanItem.offset_minutes` carries two loads at once: it lets the incumbent
option keep its real clock times when several plans are captured into one
(§6.2), and it gives the Expenses page the per-row start time its meta line
needs (`14:00 · $85 × 4`). A proposal built in step 3 leaves it NULL — the
design's stops pack end to end, so position order is enough.

Cascade rules are unchanged. `Contest` deletion still removes its `Plan`s
and `Vote`s; deleting a `PlanItem` still never deletes the `Pin`/
`TravelItem` behind it.

### Migration

One Alembic revision:

- add the eight columns above;
- add `"draft"` to the `PlanStatus` enum;
- backfill `Trip.traveller_count = NULL` (the fallback covers existing trips);
- backfill `heads = []`, `duration_minutes = NULL`, `offset_minutes = NULL`,
  `rationale = ""`;
- backfill `Contest.starts_at`/`ends_at` from the min/max of each existing
  contest's plans, so contests created before this feature still have a
  window. A contest with no plans (shouldn't exist) gets the trip start.

`backend/app/seed.py` should seed `traveller_count`, a `heads` subset on at
least one pin (to exercise the initials path), and one locked gangway-style
travel item per port day.

---

## 2. Derived values

**(amends scheduling spec "Derived values")**

```
item_duration(item) = item.duration_minutes            # the override
                   ?? item.pin.duration_minutes
                   ?? item.travel_item.duration_minutes

item_start(plan, item) = plan.starts_at + (item.offset_minutes
                          ?? sum(item_duration(x) for x in items
                                 with position < item.position))

total_duration_minutes = sum(item_duration(i) for i in plan.items)
total_cost_cents       = sum(cost_cents of i's pin/travel item)
slack_minutes          = range_minutes - total_duration_minutes
```

`moving_minutes` is **removed** — from `derive.py`, from `PlanOut` and
`ContestPlanOut` in `schemas.py`, from `PlannerContext`'s `normalizePlan`,
from `SetCard`'s metric row (it drops to two tiles: each / slack), and from
`CompareSets`. `MINUTES_PER_HOP_ESTIMATE` goes with it. The two client-side
mirrors of the same idea go too: `CompareSets`' `STOP_GAP_MIN = 10` and
`FinalItinerary`'s `MOVE_GAP_MIN = 12` both become 0, and both screens
switch to `item_start` above so stop times come from one rule instead of
three.

This is a visible change to existing screens — a locked three-stop day will
read 24 minutes slacker than it did — and it is the point: the number the
proposal flow shows a voter has to be the number the compare screen shows
the same voter five seconds later.

### Expenses

Derived on the client from `plans`; no new endpoint.

```
headcount(item)  = len(item.heads) or trip.traveller_count
                                   or len(trip.contributors)
per_head_cents(item) = round(item.cost_cents / headcount(item))   # display only
row_total_cents(item) = item.cost_cents                           # authoritative

your_share  = sum(per_head_cents(i) for i in scheduled items
                  where heads is empty or contains the viewer)
trip_total  = sum(row_total_cents(i) for i in scheduled items)
```

`cost_cents` remaining the authoritative row total is what keeps Expenses,
`CompareSets`, and `FinalItinerary` agreeing to the cent: per-head is a
display division and never a stored number, so rounding can't accumulate
into a wrong trip total.

"Scheduled items" = every `PlanItem` on a plan whose status is `placed`,
`pencilled`, or `locked`. Contested and draft plans are excluded — a
proposal isn't a cost until it wins.

---

## 3. Favicon

Assets ship as-is from the handoff: `favicon.svg` (authoritative),
`favicon-16.png`, `favicon-32.png` into `frontend/public/`, referenced from
`index.html` with the SVG as `rel="icon"` and the PNGs as fallbacks.
`favicon-preview.png` is review-only — do not ship it.

Geometry, for reference if it's ever redrawn: 16x16, `shape-rendering:
crispEdges`, background `#17171a` with the four corner pixels cleared; three
`#6f6f78` 1x2 ticks at x=2, y=4/7/10; three lines at x=4 — `#f4f4f5` 8x2 at
y=4, `#d2679e` **5x2** at y=7, `#f4f4f5` 8x2 at y=10. The short magenta line
is the mark's idea: an itinerary with one line in play.

---

## 4. Expenses screen

Route `/trips/:tripId/expenses`, added to `MAIN_SCREEN_PATHS` in
`components/core/BottomNav.jsx` and to `App.jsx`.

Bottom nav gains **Expenses** as a permanent fourth tab. Note the real bar
also carries a conditional **Compare** tab, which the handoff's nav doesn't
have — so with an open contest the bar shows five items, not four. Keep
Compare conditional and let the bar run to five; at 393pt the labels still
fit, and hiding Compare would strand the screen the "1 block open" pill
points at.

Layout, top to bottom (page `#f2f2f3`, 16px gutters, 12px card gap):

1. **Header** — existing `TripHeader` (back chevron, trip name in Lora 19px);
   static `USD` on the right in mono 11px `#7d7d84`.
2. **Section label** — mono 10px, `.14em`, `#8e8e93`, uppercase:
   `EXPENSES · {n} DAYS · {traveller_count} TRAVELLERS`.
3. **Summary card** — white, radius 12, padding 16/18, 14px gap. Left:
   `YOUR SHARE` (mono 10px, `.12em`, `#8e8e93`) over the amount in Lora
   34px/1. Right, right-aligned: `TRIP TOTAL` over the amount in Lora 22px
   `#3d3d42`. No category bar, no legend (decision 8).
4. **One card per day that has priced items** — white, radius 12, padding
   14/18/16, 12px gap. Day heading in Lora 17px, from `data/trip.js`
   `tripDayLabel` (`Day 3 · Mon Oct 19`). Then one row per priced item:
   a 3px full-height accent bar (radius 2) — `#2f7c82` normally, `#9d2d63`
   when the viewer is one of the heads — 12px gap, name (14px/600) over a
   mono 11px `#8e8e93` meta line `{start} · ${per_head} × {headcount}`, with
   `· A, M` appended when `heads` is a non-empty subset; row total
   right-aligned in mono 14px. Rows sort by `item_start`.
   Days with no priced items render no card.
5. **Collapsed free items** — a 2px/6px row: `{n} SCHEDULED ITEMS WITH NO
   COST` (mono 10px, `.1em`, `#8e8e93`) left, `SHOW` (`#9d2d63`) right.
   Tapping expands them inline as rows with an em-dash total.

`heads` is edited on the item's own edit screen (`pages/EditVisit.jsx` for
pins, the travel-item form for travel items) as a row of contributor-initial
chips, defaulting to none selected — which means everyone, and is what makes
`× traveller_count` the common case.

---

## 5. Proposal creation

### 5.1 Step 1 — entry from the add sheet

The existing `pages/DaySchedule.jsx`, unchanged, plus two additions:

- **"N blocks open" pill** in the title row, right side: white, 1px
  `#e0e0e3`, radius 14, padding 5/11, 11px `#54545a`. Counts open contests
  whose window falls on this day; hidden at zero. Taps to
  `/trips/:tripId/contests/:contestId` for the first of them.
- **"Propose a block"** is the first row of the day's **add sheet**
  (scheduling spec "Add sheet"), reached by the `+ Add` button that
  replaced the tray: a `faCalendarDay` glyph on a `--plum-tint-strong`
  chip, title 13.5px/600 over 12px `--text-secondary` "Pick hours, then
  fill them". **(amends scheduling spec "Tray")** — the handoff's
  full-width magenta button in the dark tray is gone with the tray it sat
  in; the row keeps its copy and its place at the top of the list, since
  claiming hours is the most consequential of the three things the sheet
  offers.

### 5.2 Step 2 — claim the hours

Full-screen modal over the day, own header: `Cancel` (14px `#9d2d63`) /
`Which hours?` (Lora 18px) / `DAY N` (mono 10px). Instruction line 13px
`#54545a`: "Drag over the hours your plan should replace." The day strip
repeats at `opacity: .45`, disabled — a proposal is one day.

- Existing plans desaturate: background `#f7f7f8`, left border `#c9c9cd`,
  title `#8e8e93`. Any plan fully or partly inside the selection has its
  meta line replaced by mono `INSIDE SELECTION`. They stay visible and are
  not deleted.
- **Selection rectangle**: `rgba(157,45,99,.10)` fill, 2px dashed `#9d2d63`,
  radius 10, full grid width, with 18px round white handles (3px `#9d2d63`
  border) at top-left and bottom-right.
- **Readout pill** anchored inside the selection's top-right, 10px below its
  top edge: `#9d2d63`, radius 14, padding 5/12, mono 11px `.08em` `#fff` —
  `13:00 – 18:00 · 5H`. Live during the drag.
- Hour labels inside the range turn `#9d2d63`.
- **Footer** (white, 1px `#e6e6e8` top border, padding 14/16/22): "N item(s)
  sit in these hours" (13px `#54545a`) with a static `SNAP TO 15M` label
  (mono 10px `#9d2d63`) right — it states the behavior, it is not a toggle —
  then a full-width `#17171a` radius-10 **Fill these hours** (15px/600).
  Disabled under a 30m selection.

Interactions: press-and-drag on empty grid starts a selection; dragging over
an existing plan still selects (it does not start a plan drag — note this
inverts `DaySchedule`'s existing `DRAG_THRESHOLD_PX` handling inside the
modal); both handles draggable; snap to 15m, reusing `SNAP_MIN`.

### 5.3 Step 3 — build the set

Header: back chevron / `Your block` (Lora 18px) / window `13:00–18:00`
(mono 10px `#9d2d63`).

1. **Budget strip** — white, 1px `#e6e6e8`, radius 12, padding 12/14:
   "5h claimed · 4h 15m planned" (13px/600) over mono 10px
   `45M SLACK LEFT`; right, a 96x8 radius-4 `#ececee` track with a `#9d2d63`
   fill weighted `planned / claimed`.
2. **Stops list** — white, radius 12, padding 6/14/14. Each row 12px
   vertical padding, separated by 1px `#f0f0f1`: start time (mono 11px
   `#8e8e93`, fixed 44px column), 3px `#9d2d63` accent bar, name (14px/600)
   over mono 10px `#8e8e93` meta (`2H 30M · $62 × 4`, or
   `1H 30M · SHORTENED FROM 3H` when the stop carries a duration override),
   drag handle `#c2c2c7` right.
   - Last row is an **"Add a stop"** dashed placeholder: 1px dashed
     `#d4d4d8`, radius 8, padding 9/12, "Add a stop" 13px `#8e8e93` with the
     remaining time right in mono 10px (`30M FREE`). Its time column shows
     the next free start in `#c2c2c7`.
   - **Stops pack end to end from the window start, in list order, so
     overlap is structurally impossible.** Reordering recomputes every start.
     Durations are editable and write `PlanItem.duration_minutes`; total
     duration may not exceed the window. Deliberate free time is allowed and
     lands at the end, where the slack readout covers it.
3. **Pull in** — wrapping chips: white, 1px `#e0e0e3`, radius 14, padding
   7/12, 12px. Sources: items already inside the claimed hours, unplaced
   pins (those in a region this day is already about first), unplaced
   travel items, and `New stop` for an inline-created item.

   The chips are split into **two labelled groups by availability**, since
   a block is a day *and* a range of hours and pins already carry an
   answer for exactly that pair:

   - `PULL IN · WORKS THESE HOURS` — mono 10px `.14em` — holds every
     source whose availability says *works* for this block (definition
     below). `New stop` sits at the end of this group: a stop invented
     here is never ruled out.
   - `RULED OUT THESE HOURS` — mono 10px `.14em` in `#a6a6ac`, shown only
     when non-empty — holds the rest, as dashed-border `#a6a6ac` chips,
     with the distinct `reasons` of the rules behind them on an 11px
     `#a6a6ac` line under the label and on each chip's `title`.

   **Ruled-out chips stay tappable.** Availability is the group's own note
   about a place, not a server-enforced constraint — nothing in §6 checks
   it — and overrides exist precisely so the group can decide a rule is
   wrong. Someone who knows the shop opens late pulls the pin in and makes
   the case in *Why (optional)*; a disabled chip would leave them no way
   through. This is also why the group is a *split*, not a filter: hiding
   the ruled-out pins would make "nothing has tied this down yet" and "the
   ticket office shuts at 16:30" both read as simply absent, and would
   hand a day with no matches an empty list — the same reason the region
   sort above hides nothing either.

   **"Works" for a block** is the existing per-cell rule from
   `AvailabilityGrid`, asked of a window instead of a cell:

   ```
   works(pin, day, band) = overrides[pin|day-band] ? !allows(rule, day, band)
                                                   : allows(rule, day, band)
   allows(rule, day, band) = (rule has no days  or day  in rule.days)
                         and (rule has no bands or band in rule.bands)

   worksForBlock(pin) = any(works(pin, calendarDay, b)
                            for b in bandsTouched(window))
   ```

   - `day` is a **calendar day-of-month**, not a trip-day index —
     `AvailabilityRule.days` and the override keys have always been in
     that currency, so the step's trip-relative `dayIndex` converts
     through `getTripDays()` first, the same conversion `EditVisit` makes
     for its "placed" cell.
   - `bandsTouched` is every AM/PM/EVE band the window overlaps,
     half-open at both ends: 13:00–18:00 is PM alone, 13:00–20:00 is
     PM + EVE.
   - **Any** band, not every band: the stop only has to fit *somewhere*
     inside the block, so a PM-only pin belongs in a 13:00–20:00 block.
     Requiring every band would rule it out while the free PM hours sat
     visible in the list above.
   - A pin with no rule, a rule with an empty axis, and every travel item
     all answer *works* — so the second group means specifically "ruled
     out", never "unknown".
4. **Note card** — `#fdf6fa`, 1px `#eed4e2`, radius 10, padding 11/13,
   12px/1.5 `#7b1f4c`: "Stops snap end to end inside the block, so they can
   never overlap. Pinned times stay put." (Copy amended from "Gangway times
   stay pinned" — see §6.5: a pinned item is never *inside* a claimed
   window, so the original sentence would over-promise.)
5. Footer: full-width `#17171a` radius-10 **Review proposal**.

### 5.4 Step 4 — review and send to vote

Header: back / `Review` / `DAY N`.

1. **Name card** — white, radius 12, padding 14: mono `NAME THIS SET`, a
   text field styled as a 2px `#9d2d63` bottom border with the value in Lora
   20px, and the set letter right in mono 10px `#9d2d63` (`SET C`). The
   letter is derived, not stored: options in a contest are lettered by
   `created_at`, incumbent first — A is always what's on the board. The
   typed name writes `Plan.label`.
2. **Comparison, two equal columns, 10px gap:**
   - *On the board* — white, radius 12, padding 12/13: mono `ON THE BOARD`,
     12px `#54545a` lines for the incumbent's stops, then mono 10px
     `#a6a6ac` `1 STOP · 2H SLACK` and `$340 TOTAL`.
   - *Your set* — `#fdf6fa`, 1px `#eed4e2`: `YOUR SET` in `#9d2d63`, lines in
     `#7b1f4c`, summary in `#b0648c`.
   Both totals come from §2, so Expenses, the compare screen, and this card
   are one number.
3. **Why (optional)** — white card, mono `WHY (OPTIONAL)`, free text
   13px/1.5 `#3d3d42`, writes `Plan.rationale`. Shown to voters on
   `CompareSets`.
4. **Vote card** — white, radius 12, padding 14: "Goes to a vote" (14px/600)
   with the planner count right (mono 10px `#8e8e93`), a row of 26px
   `#e4e4e7` initial avatars (reuse `AvatarStack`), and a 12px `#8e8e93`
   explainer. **Copy amended (decision 4):** "The block shows as contested
   on Day 3 until the trip owner picks a set."
5. Footer, 10px gap: `Save draft` (1px `#e0e0e3`, radius 10, padding 14/16,
   15px `#54545a`) and a flex-1 `#9d2d63` radius-10 **Send to vote**
   (15px/600 `#fff`).

---

## 6. Server behavior

### 6.1 Overlap and occupancy

**(amends scheduling spec "Direct placement")** `_OCCUPYING_STATUSES` stays
`placed | pencilled | contested | locked` — `draft` is **not** occupying, so
a private draft never blocks anyone else's placement.

A `409` from direct placement now returns the occupying plan's `contest_id`
alongside its id, so the client can offer "add a set to the open vote"
rather than always opening a fresh propose sheet.

### 6.2 Proposing — the window contest

**(amends scheduling spec "Proposing an alternative")** `POST
/api/trips/{trip_id}/contests` no longer takes `against_plan_id`. It takes a
window and a set of stops.

1. Find every plan on the trip overlapping `[starts_at, ends_at)` with
   status `placed`, `pencilled`, or `contested`. Locked plans are excluded
   (§6.5); draft plans are invisible here.
2. If any of them already belongs to an open contest:
   - window **exactly equal** to that contest's window → attach the new plan
     to it as a further option (this is how `SET C` comes to exist) and
     return it;
   - window **differs** → `409` with the conflicting contest's id and
     window, so step 2 can say which hours are already out for a vote.
3. Otherwise create `Contest(status="open", starts_at, ends_at)`.
4. Capture the overlapping plans into **one incumbent option**: a new `Plan`
   spanning the whole window, status `contested`, holding every captured
   plan's items with `offset_minutes` set from their original start times
   and `duration_minutes` set from their original durations. The captured
   plans are then deleted. Preserving offsets is what keeps "on the board"
   reading `14:00 · Maya Chan, 3h` inside a 13:00–18:00 window instead of
   sliding it to 13:00.
5. Create the proposing `Plan(status="contested", contest_id=...)` spanning
   the window, with the submitted items in order (`offset_minutes` NULL —
   packed).
6. A window with no overlapping plans is legal: the contest is created with
   a **single** option and no incumbent. `CompareSets` renders it as one set
   with nothing to compare against; the owner locks it to put it on the
   board. This is the handoff's "a day with no existing items" edge case.

**Consequence worth knowing:** capture is destructive in the same way
locking already is. If the incumbent option wins, the board keeps one
window-sized plan where it previously had (possibly several) tighter ones,
and `reopen` does not un-merge it — consistent with the existing rule that
reopening "does not restore any plans deleted at lock time."

### 6.3 Voting, locking, reopening

Unchanged from the scheduling spec: one `Vote` per contributor per contest,
toggleable; owner-only lock sets the winner to `locked` and deletes the
other options; owner-only reopen sets a locked plan back to `placed` and its
contest back to `open`.

**Added (decision 4):** `ContestOut` gains `majority_plan_id` — the plan
holding strictly more than half of `contributor_count`, else null.
`CompareSets` shows that plan as `MAJORITY` alongside the existing
`LEADING` badge, and the lock button reads as the owner confirming it.
Nothing resolves automatically.

### 6.4 Drafts

**(new)** `Plan.status = "draft"`:

- created by `POST /api/trips/{trip_id}/plans` with `status: "draft"`, or by
  step 4's `Save draft`, which posts the window and stops as a draft plan
  and creates **no** contest and captures **no** incumbents;
- never occupies time, so it skips the overlap check entirely;
- visible only to `created_by_id` — `GET /api/trips/{trip_id}/plans` filters
  `status == draft AND created_by_id != me` out for every caller, and
  `GET /api/plans/{id}` 404s for anyone else;
- never broadcast on the trip's event channel;
- excluded from the day grid, Expenses, `CompareSets`, and `FinalItinerary`;
- surfaced on the day's add bar as a "1 draft block" row that reopens
  step 3 — on the bar itself, not inside the add sheet, since a draft is
  something to return to rather than something to add;
- publishable via `POST /api/plans/{plan_id}/publish`, which runs §6.2 from
  step 1 using the draft's own window and items and then deletes the draft.
  Publishing can `409` if the hours have gone to a vote in the meantime;
  the client reopens step 2 with that message.

This is the app's first per-contributor read filter. Put it in one helper in
`routers/plans.py` and call it from every plan-listing path rather than
letting the condition spread.

### 6.5 Pinned items (locked plans)

**(amends scheduling spec "Calendar grid")** Gangway up/down and embark are
modelled as travel items on **locked** plans, locked directly by the owner
via the existing `POST /api/plans/{plan_id}/lock`.

Today a locked plan makes its hours entirely inert. That stays true for
direct placement and the quick propose sheet. For the step-2 selection, the
rule is relaxed to: **a selection may not contain a locked plan, and clips
at one.** Dragging across a locked span stops the selection at its nearest
edge, and the span renders with the disabled treatment plus a mono
`PINNED` label.

So a pinned item is never inside a claimed window, which is why the note
card's copy changes (§5.3). The alternative — packing stops around a locked
span mid-window — is deliberately out of scope for v1: it makes "stops pack
end to end" false and the slack arithmetic conditional, for a case the
design's own example never shows.

### 6.6 The existing quick-propose sheet

`DaySchedule`'s current tap-an-occupied-slot sheet stays, and becomes the
degenerate case of the same flow: window = the tapped start plus the armed
item's duration, one stop, no name, no rationale. It posts to the same
endpoint. Two entry points, one server path.

---

## 7. API

Changed:

- `POST /api/trips/{trip_id}/contests` — propose a block.
  Body: `{ starts_at, ends_at, label?, rationale?, items: [{ pin_id? |
  travel_item_id?, duration_minutes? }] }`. `against_plan_id` is removed.
  `409` carries `{ contest_id, starts_at, ends_at }` on a partial-overlap
  clash with an open contest.
- `POST /api/trips/{trip_id}/plans` — `status` accepts `"draft"`;
  `409` detail gains `occupying_contest_id`.
- `GET /api/trips/{trip_id}/plans` — filters other people's drafts.
- `GET /api/contests/{contest_id}` — `ContestOut` gains `starts_at`,
  `ends_at`, `majority_plan_id`; each plan gains `rationale` and a derived
  `set_letter`.
- `PATCH /api/pins/{pin_id}`, `PATCH /api/travel-items/{id}` — accept
  `heads`.
- `PATCH /api/trips/{trip_id}` — accepts `traveller_count`.

New:

- `POST /api/plans/{plan_id}/publish` — turns the caller's draft into a
  contest proposal (§6.4). Author-only.

Response shapes:

```
PlanOut:
  id, trip_id, starts_at, ends_at, label, color, status, contest_id,
  rationale
  items: [{ pin, travel_item, position, duration_minutes, offset_minutes,
            start_minute_of_day }]
  total_duration_minutes, total_cost_cents, slack_minutes
  # moving_minutes removed

ContestOut:
  id, trip_id, status, winning_plan_id, starts_at, ends_at,
  majority_plan_id
  plans: [PlanOut + vote_count, voted_by_me, set_letter]
  voted_count, contributor_count, my_vote_plan_id

PinOut / TravelItemOut:  + heads: [contributor_id]
TripOut:                 + traveller_count
```

`start_minute_of_day` is served pre-computed so the Expenses page and the
compare/itinerary stop lists don't each re-derive packing.

## 8. Realtime events

`backend/app/events.py`, published on the trip channel. Existing events are
unchanged; drafts publish nothing.

- `contest.opened` — payload gains `starts_at`, `ends_at`.
- `plan.captured` *(new)* — a plan was absorbed into an incumbent option, so
  open day views can drop it.
- `plan.published` *(new)* — a draft became a contested option.

---

## 9. Frontend

**Routes** (`App.jsx`), all modal-style, so they stay out of
`MAIN_SCREEN_PATHS`:

```
/trips/:tripId/expenses                 → Expenses            (main screen)
/trips/:tripId/schedule/:day/propose    → ProposeBlock (steps 2-4)
```

Step state lives in the route component, not the URL — back from step 3
returns to step 2 with the selection intact. Register the draft with
`state/NavGuard.jsx` so a stray tab tap can't discard it, the same way
`EditVisit` does.

**State** (`state/PlannerContext.jsx`): `normalizePlan` gains `rationale`
and per-item `durationMinutes` / `offsetMinutes` / `startMinuteOfDay`, and
loses `movingMinutes`. Pins and travel items gain `heads`; trip gains
`travellerCount`. The proposal draft is local to the flow:

```
{ dayIndex, windowStartMin, windowEndMin,
  stops: [{ pinId | travelItemId | newItem, durationMinutes }],
  name, rationale }
```

with `plannedMin = sum(durations)`, `slackMin = windowMin - plannedMin`, and
each stop's start = `windowStart + cumulative duration`.

**API client** (`lib/api.js`): `proposeAlternative` changes signature to the
window shape; add `publishPlan`, `patchTrip` (for `traveller_count`).

**Components**: reuse `TripHeader`, `BottomNav`, `Card`, `Chip`,
`AvatarStack`, `MetricTile`, `SetCard`, `PlanBlock`, and the day strip and
grid out of `DaySchedule` — step 2 renders the *same* grid with a selection
layer over it, not a copy of it. New: `ExpensesPage`, `ProposeBlock` (the
three-step shell), `WindowSelection`, `StopList`, `BudgetStrip`,
`ComparisonColumns`, `PullInChip`; `AddSheet` (scheduling spec "Add
sheet"), which absorbs the tray's unplaced list, region filter, delete
confirmation and travel-item form.

**Availability** needs no server work — `PinOut` already ships
`availability_rule` and `availability_overrides`, and `PlannerContext`
already normalizes both into `pin.availabilityRule` and `state.overrides`.
Two helpers, so the rule has one spelling:

- `lib/availability.js` *(new)* — `ruleAllows`, `worksOn`,
  `worksInAnyBand`, `reasonsFor`. `AvailabilityGrid` switches its inline
  `okBase` onto these, for the same reason §2 collapses three definitions
  of slack into one: a voter must not read *works* on the pin's own screen
  and see a hatched cell five seconds later.
- `lib/planTime.js` — `bandsForMinuteRange(startMin, endMin)`, exporting
  the band boundaries `BAND_MINUTE_RANGES` already holds.

**Note, in passing:** `AvailabilityGrid`'s `okBase` guarded the no-rule
case with `!rule`, but `normalizePin` hands every pin a rule *object*
(`{days: null, bands: null, why: []}`) and never null, so that branch was
dead and every pin without a rule rendered as fully hatched — the opposite
of the documented intent ("a pin with no rule is treated as available
every day/band", `data/pins.js`). `ruleAllows` reads each axis on its own
and fixes this, which visibly unhatches the grid for most pins on the
board.

**Fetching**: the day's plans, unplaced pins for the region, the contributor
roster, and any open contests whose window touches this day (for the pill,
and to block a partially-overlapping selection before the user reaches
step 4).

---

## 10. Design tokens

Unchanged from the handoff and additive to `styles/`; map to existing CSS
variables where one already means the same thing rather than introducing a
second spelling.

Colors: ink `#17171a`; nav `#111114`; text `#3d3d42`, `#54545a`; muted
`#8e8e93`, `#7d7d84`; faint `#a6a6ac`, `#c2c2c7`; page `#f2f2f3`; surface
`#fff`; hairline `#e6e6e8`, `#e0e0e3`, `#f0f0f1`, `#ececee`; disabled
`#f7f7f8` / `#c9c9cd`; teal `#2f7c82` (tint `#eef4f4`, mid `#63a3a7`);
magenta `#9d2d63`, deep `#7b1f4c`, mid `#b0648c`, light `#d2679e` /
`#e08ab4` / `#f0c7dc`, tint `#fdf6fa`, tint border `#eed4e2`; avatar
`#e4e4e7`.

Spacing 2/6/8/10/12/14/16/20/22; page gutter 16, header gutter 20, card gap
12. Radius 4/6/8/9/10/12/14/34/44. Type: Lora 500 at 34/22/20/19/18/17/16;
system sans at 15/14/13/12, weight 600 for titles; IBM Plex Mono 400 at
11/10/9/8, uppercase, `.08–.14em`. Grid 60px/hour (matches the app's
`PX_PER_MIN = 1`), 15m snap, 56px time gutter (the app uses `GUTTER_W = 44`
— **the app wins**). Cards are flat; the canvas's device shadow is
presentation only.

Icons (back chevron, gear, drag handle) come from the app's existing
FontAwesome set; the reference canvas approximates them with text glyphs.

---

## 11. Validation and edge cases

- Selection minimum 30m; both edges snap to 15m; a selection may not cross
  midnight (a proposal is one day) — even though a *placement* may, and
  the picker now shows and clips at one that does (scheduling spec
  "Overnight plans"). Relaxing this would mean a window contest spanning
  two days, an AM/PM/EVE band set that wraps, and a slack readout that
  stops being one day's arithmetic; it is deliberately left closed.
- Selection clips at a locked plan (§6.5) and at the grid's 00:00/24:00
  bounds.
- A selection partially overlapping an open contest's window is refused in
  step 2 with the offending hours named; an exactly-matching one is allowed
  and adds a set.
- At least one stop; `sum(durations) <= window`; a stop's override must be
  >= 15m.
- A pin or travel item may appear at most once in a proposal.
- Availability grouping in step 3 never blocks anything: a ruled-out chip
  still adds its stop, and the server never checks a rule. A block on a
  trip with no `start_date` has no calendar day to ask about, so every
  chip lands in the works group.
- A window lying entirely before 06:00 touches no band range; it falls
  back to `bandForMinuteOfDay(start)` rather than returning an empty band
  list, which would silently rule every pin out.
- Deleting a pin or travel item referenced by *any* `PlanItem` still `409`s,
  drafts included — with a message naming the draft, since its author may be
  someone else and the plan is invisible to the caller.
- Zero-priced trip: Expenses shows the summary card at `$0` and the
  collapsed free-items row.
- Trip with no `traveller_count` and no contributors (impossible in
  practice, but the division guard matters): headcount floors at 1.
- Reopening a contest whose window has since been partly filled by direct
  placement: the reopened plan can now overlap. Detect on reopen and `409`
  with the occupying plan, rather than creating a silent overlap.

---

## 12. Build order

1. **Migration and model** — the eight columns, the `draft` enum value, the
   `Contest` window backfill, seed data.
2. **Derived values** — `derive.py` without moving time, `item_start`,
   `start_minute_of_day` in the schemas; fix `CompareSets`,
   `FinalItinerary`, and `SetCard` in the same pass so the app is never
   showing two slack definitions at once.
3. **Expenses** — `heads` and `traveller_count` through the API, the
   screen, the nav tab. Self-contained and shippable on its own.
4. **Window contests server-side** — the rewritten `propose_alternative`,
   capture-into-incumbent, `majority_plan_id`, the new events.
5. **Drafts** — status, read filtering, `publish`.
6. **Proposal flow UI** — steps 2, 3, 4 over the existing grid; rewire the
   quick-propose sheet onto the same endpoint; the "N blocks open" pill.
   Step 3's Pull in groups come with it, along with the shared
   `lib/availability.js` the grid then switches onto (§9).
7. **Favicon.**

## 13. Tests

There is no committed test suite yet; this feature should start one under
`backend/tests/`.

- Capture: a window over 0, 1, and 3 existing plans; offsets and duration
  overrides preserved on the incumbent; captured plans deleted.
- Window clash: exact-match window adds an option; partial overlap `409`s
  with the contest's window.
- Locked plans are never captured and never deleted by a lock.
- Drafts: invisible to other contributors on list and get; not occupying;
  publish converts and 409s on a raced window; delete-pin 409 names a draft.
- Lock and reopen across a window contest, including reopen into hours that
  have since been filled.
- `majority_plan_id` at exactly half, just over half, and after a vote is
  withdrawn.
- Derived values: slack with and without overrides; `item_start` packed vs
  offset; per-head rounding never changes a row total or the trip total.
- Availability (`lib/availability.js`, `bandsForMinuteRange`): a window
  half-open at a band edge (13:00–18:00 is PM, not PM+EVE); a straddling
  window matching a single-band pin; wrong day; a pin with no rule and a
  rule with one empty axis both working everywhere; an override flipping a
  cell in each direction; a pre-06:00 window never yielding an empty band
  list.

---

## 14. Assumptions carried into this doc

Not in the handoff, decided here, worth a second look before build:

1. **Bottom nav runs to five tabs** when a contest is open (Board /
   Schedule / Compare / Final / Expenses). The handoff drew four.
2. **Capture is destructive** and `reopen` does not un-merge a winning
   incumbent (§6.2).
3. **A claimed window may not contain a pinned item** — the selection clips
   instead, and the step-3 note card copy changes to match (§6.5).
4. **`SNAP TO 15M` is a static label**, not a toggle.
5. **Set letters are derived** from option `created_at`, incumbent = A, not
   stored — so a letter can shift if an option is removed.
6. **Expenses counts `locked`, `placed`, and `pencilled` plans only**, and a
   pencilled item's cost is included; if pencilled should read as
   provisional, the summary card needs a second number.
7. **Availability splits step 3's Pull in list rather than filtering it**,
   and a ruled-out stop can still be proposed (§5.3). If the group wants a
   rule to actually *hold*, that is a server-side check in §6.2 and a
   different decision.
8. **A pin qualifies on any band the window touches**, not every one
   (§5.3). The looser rule is right for a block that straddles PM and EVE;
   it does also mean a PM-only pin can be dragged into the block's evening
   hours in the stop list, where nothing re-checks it.
9. **Fixing `okBase` unhatches the availability grid** for every pin with
   no rule (§9). Intended, and matches `data/pins.js`, but it changes how
   an existing screen looks for most of the board.
