# Scheduling feature — implementation spec

## Overview

Contributors place pins and travel items onto a trip's calendar at a
specific date/time with a specific duration. Placement happens by tapping an
item in the day's add sheet, then tapping a target time on the calendar.
When someone wants to schedule something else against a time that's already
occupied, they propose it as an alternative; the group votes, and the trip
owner locks one option, which becomes final until explicitly reopened.

## Existing entities used by this feature

- **Trip**: `id`, `start_date`, `end_date`, `phase`.
- **Contributor**: `id`, `trip_id`, `email`, `display_name`, `is_owner`.
- **Pin**: `id`, `trip_id`, `title`, `short`, `region`, `lat`, `lng`,
  `duration_minutes`, `cost_cents`, `notes`, `link`, `tags`,
  `availability_rule`, `availability_overrides`.
- **Comment**: attaches to either a pin or a plan (see below) via
  `pin_id` / `plan_id`, plus `contributor_id` and `body`.

## Data model

```
TravelItem
  id, trip_id
  title: string
  kind: string                     # "travel" | "lodging" | "other"
  duration_minutes: int (default 60)
  cost_cents: int (default 0)
  notes: text
  link: string
  added_by_id: Contributor.id (nullable)
  added_at: datetime

Plan                                # one scheduled placement
  id, trip_id
  starts_at: datetime (tz-aware)
  ends_at: datetime (tz-aware)
  label: string (default "")
  color: string (default "var(--accent)")
  status: enum "placed" | "pencilled" | "contested" | "locked"
  contest_id: Contest.id (nullable)
  created_by_id: Contributor.id (nullable)
  created_at: datetime

PlanItem                            # one pin or travel item within a plan
  id, plan_id
  pin_id: Pin.id (nullable)
  travel_item_id: TravelItem.id (nullable)
  position: int
  CHECK: exactly one of pin_id / travel_item_id is set

Contest                             # created on demand when an alternative is proposed
  id, trip_id
  status: enum "open" | "resolved"
  winning_plan_id: Plan.id (nullable, set on resolution)
  created_at: datetime
  resolved_at: datetime (nullable)

Vote
  id, contest_id, plan_id, contributor_id, created_at
  UNIQUE(contest_id, contributor_id)   # one vote per person per contest, toggleable
```

All foreign keys cascade-delete with their parent (`Plan` deletion removes
its `PlanItem`s; `Contest` deletion removes its `Plan`s and `Vote`s).
Deleting a `PlanItem` never deletes the `Pin`/`TravelItem` it points to.

## Server behavior

**Direct placement.** Create a `Plan` with `status = "placed"` (or
`"pencilled"`) and one or more `PlanItem`s. Reject with `409` (returning the
occupying plan's id) if `[starts_at, ends_at)` overlaps any existing
`placed`/`pencilled`/`contested`/`locked` plan in the trip — any shared
minute counts as overlap. A caller who receives this should use the
propose-alternative flow instead of retrying direct placement.

**Proposing an alternative.** Takes a target `plan_id` plus a new
`starts_at`/`ends_at`/`items` (its time range only needs to overlap the
target's, not match it). If the target plan has no `contest_id`, create a
`Contest(status="open")`, set the target's `contest_id` to it, and set the
target's `status` to `"contested"`. If the target already has a
`contest_id`, attach the new plan to that existing contest instead of
creating a second one. Create the new `Plan(status="contested",
contest_id=...)` with the given items. Reject with `403` if the target plan
is `locked`.

**Voting.** One `Vote` per contributor per contest. Voting for a plan you
already voted for removes the vote (toggle). Voting for a different plan in
the same contest replaces the existing vote.

**Locking.** Owner-only. Given a `plan_id` within a contest: set that plan's
`status` to `"locked"`; delete every other plan in the contest (and their
items — the underlying pins/travel items are untouched and become unplaced);
set the contest's `status` to `"resolved"` and `winning_plan_id` to the
locked plan's id.

**Reopening.** Owner-only, only on a `locked` plan: set its status back to
`"placed"` and its contest's status back to `"open"`. This does not restore
any plans deleted at lock time — a fresh alternative would need to be
proposed again if wanted.

**Moving / unplacing.** `PATCH` a plan's `starts_at`/`ends_at` only when its
status is `placed` or `pencilled`. `DELETE` a plan only when `placed` or
`pencilled`; this removes it and its items, returning the underlying
pins/travel items to the unscheduled tray.

## API

- `GET /api/trips/{trip_id}/plans` — all plans for the trip.
- `POST /api/trips/{trip_id}/plans` — direct placement.
  Body: `{ starts_at, ends_at, status, items: [{ pin_id? , travel_item_id? }] }`
- `PATCH /api/plans/{plan_id}` — move. Body: `{ starts_at?, ends_at? }`
- `DELETE /api/plans/{plan_id}` — unplace.
- `POST /api/trips/{trip_id}/contests` — propose an alternative.
  Body: `{ against_plan_id, starts_at, ends_at, items }`
- `GET /api/contests/{contest_id}` — a contest and all its plans.
- `POST /api/contests/{contest_id}/vote` — Body: `{ plan_id }`
- `POST /api/contests/{contest_id}/lock` — owner-only. Body: `{ plan_id }`
- `POST /api/plans/{plan_id}/reopen` — owner-only.
- `GET /api/trips/{trip_id}/travel-items` — all travel items for the trip.
- `POST /api/trips/{trip_id}/travel-items` — create.
  Body: `{ title, kind, duration_minutes, cost_cents, notes, link }`.
  `kind` is validated against `"travel" | "lodging" | "other"` and
  defaults to `"other"`; anything else is a `422`.
- `PATCH /api/travel-items/{id}` — edit.
- `DELETE /api/travel-items/{id}` — reject with `409` if referenced by any
  `PlanItem`.
- `DELETE /api/pins/{pin_id}` — permanently deletes the pin itself (not
  just its placement). Reject with `409` if referenced by any `PlanItem`,
  same as travel items above — a scheduled pin has to be unplaced
  (`DELETE /api/plans/{plan_id}`) first.

**Response shapes.**

```
PlanOut:
  id, trip_id, starts_at, ends_at, label, color, status, contest_id
  items: [{ pin: PinOut|null, travel_item: TravelItemOut|null, position }]
  total_duration_minutes, total_cost_cents, moving_minutes, slack_minutes

ContestOut:
  id, trip_id, status, winning_plan_id
  plans: [PlanOut, with per-plan vote_count and voted-by-me flag]
  voted_count, contributor_count, my_vote_plan_id

TravelItemOut:
  id, trip_id, title, kind, duration_minutes, cost_cents, notes, link,
  added_by_id, added_at
```

## Derived values

Every span is measured across real dates, never within one day. A plan may
cross midnight — a night crossing, a red-eye, a lodging stay — so
`range_minutes` is the true difference between `starts_at` and `ends_at`,
and a client that computes it from clock times alone has to carry whole
days into the date rather than wrapping at 24:00. See "Overnight plans"
below.

For a plan spanning `range_minutes` total minutes:

```
total_duration_minutes = sum(item.duration_minutes for item in plan.items)
                          # item.duration_minutes reads from item.pin or
                          # item.travel_item, whichever is set
total_cost_cents        = sum(item.cost_cents for item in plan.items)
moving_minutes          = max(0, (len(plan.items) - 1) * 12)
slack_minutes           = range_minutes - total_duration_minutes - moving_minutes
```

## Realtime events

Publish on the trip's event channel: `plan.placed`, `plan.moved`,
`plan.removed`, `contest.opened`, `contest.vote_changed`,
`contest.resolved`, `plan.reopened`, `travel_item.created`,
`travel_item.updated`, `travel_item.removed`.

## Frontend

**State**: `plans` (flat array, each carrying `contestId`), `travelItems`
(map keyed by id, same shape convention as `pins`). Group plans sharing a
`contestId` client-side to render a contest's competing options together.

**API client functions**: `listPlans`, `createPlan`, `movePlan`,
`deletePlan`, `proposeAlternative`, `getContest`, `toggleContestVote`,
`lockContest`, `reopenPlan`, `listTravelItems`, `createTravelItem`,
`patchTravelItem`, `deleteTravelItem`.

**Add bar**: the dark strip under the grid, one row. A full-width
**+ Add** opens the add sheet below; beside it a **"N unplaced"** button
counts every pin and travel item not currently referenced by any
`PlanItem` and opens the same sheet on its picker. Under the row, the
viewer's own `draft` blocks for this day (proposals spec §6.4) — nobody
else can see a draft, which is why it needs somewhere to be seen.

This replaced a tray that laid its contents out in full: a caption, a
region-filter rail, a horizontal strip of item cards, a "Propose a block"
button and the drafts. On a 402x874 phone that stack ran to roughly 300px
against a 60px/hour grid — about five hours of the day, permanently spent
on a panel that is only touched at the moment something is being added.
The bar costs ~100px, and browsing moved behind the tap that was already
there.

**Add sheet**: a bottom sheet with three modes; back from either sub-mode
returns to the menu with the sheet still open, so it reads as one panel
rather than three.

- *Menu* — three rows: **Propose a block** (routes to the proposals
  spec's hour picker), **Add a pin** (the picker, disabled at zero
  unplaced), **Custom event** (the form). Tints follow the app's
  one-hue-per-meaning rule: plum for the block, teal for the pin, stone
  for the custom event.
- *Picker* — the unplaced items, travel items in their own section above
  the pins (they carry no region, so the filter says nothing about them,
  and an unplaced ferry buried among twenty pins is one that gets
  forgotten). The region filter lives here, defaulting to the regions
  this day is already about. Tapping a row arms it for placement (enters
  "Placing <item> — tap the calendar") and closes the sheet. Each row
  also carries a trailing delete button at `--hit-min` (44px), which
  deletes the item outright (`DELETE /api/pins/{id}` / `DELETE
  /api/travel-items/{id}`) with the same double-tap-to-confirm behavior as
  the details sheet's "Delete permanently" — one armed row at a time
  across the list. Deleting the item currently armed for placement also
  cancels placing mode.

  The delete badge used to appear only on a card already armed for
  placement. In a list, tapping a row arms placement *and* closes the
  sheet, so there is no armed state left to hang it on; it becomes a
  persistent second target instead, separable by thumb from the row body.
- *Custom event* — title, kind, duration, cost and the `heads` split,
  creating a `TravelItem`. It is the only way to create one, so it
  carries the whole `kind` set, not just `other`. On success the new item
  is armed for placement, since the sheet was opened from a day.

**Calendar grid**: a vertical time axis for the selected day, with plans
positioned and sized by real minute-to-pixel mapping (not fixed-height
rows). Tapping an item in the add sheet's picker enters placing mode — a
banner pinned to the
header (not scrolled with the grid, so it and its Cancel button stay
visible no matter how far down the day the target time is) reads "Placing
<item> — tap the calendar" — which highlights valid 15-minute-increment
targets on the grid:
- Tapping empty time places the item directly (`POST /plans`) at the tapped
  time, using the item's own `duration_minutes`.
- Tapping time already occupied by a non-locked plan opens the
  propose-alternative sheet, pre-filled with the tapped time and duration,
  targeting that plan.
- Tapping time occupied by a locked plan is a no-op (locked plans must be
  reopened first, by the owner, before anything new can be proposed there).

Tapping an already-placed, non-contested plan opens a details sheet
(a bottom sheet overlaid on the calendar, not a routed page — deliberately,
so the grid stays mounted underneath and its scroll position is never
disturbed by opening/closing it) where its date, time, and duration can be
adjusted — each change calls `PATCH /api/plans/{plan_id}` (spec "Moving /
unplacing"), reverting on a `409` with an inline "that time is already
taken" error, same as drag-to-reschedule on the grid.

The sheet has two ways to lose this plan's placement, gated to
placed/pencilled plans:
- A small **✕ on Start time** unplaces only (`DELETE /api/plans/{plan_id}`)
  — a plain single tap, no confirmation. The pin/travel item itself is
  untouched and lands back in the unscheduled tray, so this is the
  easily-undone action (place the same item again) and behaves like
  clearing any other field.
- **Delete permanently**, its own button below, unplaces and then deletes
  the underlying pin or travel item itself (`DELETE /api/pins/{id}` /
  `DELETE /api/travel-items/{id}`) — it's gone from the trip entirely, not
  just off the calendar. This one still requires a second tap within a few
  seconds to confirm (armed state reads "confirm?"; a single tap alone
  does nothing), since it can't be undone from here.

For a single-item plan (every plan the app creates today), "Duration" on
this sheet is the same field as "Duration" on the pin's own edit screen
(`PATCH /api/pins/{id}` / `PATCH /api/travel-items/{id}`'s
`duration_minutes`) — not a separate, plan-local number. Changing it here
resizes the plan's window (`PATCH /api/plans/{plan_id}`) and, once that
succeeds, patches the underlying pin/travel item's own `duration_minutes`
to match; changing it on the pin's edit screen patches the pin and, if it's
currently placed on a placed/pencilled plan, resizes that plan's window the
same way. Either direction reverts/no-ops instead of updating the other
value if the resize would overlap another plan.

**Overnight plans**: a plan may start on one day and end on another. The
model has always allowed it — `starts_at`/`ends_at` are real datetimes and
every overlap check is a datetime comparison — and the day views have to
follow:

- A day shows every plan **touching** it, not every plan starting on it.
  One helper turns a plan into its minutes relative to a given day, which
  may be negative (it began the night before) or past 1440 (it runs into
  tomorrow); the grid, the column-packing sweep, the placement overlap
  check, the open-contest windows and the proposal flow's hour picker all
  read those entries.
- A block is **clipped to the grid** and marks which way it runs on: the
  clipped edge is square, and a double-chevron rides inline with the title
  (like the lock, and for the same reason — a compact block hides its
  subtitle, and the tail of a crossing is exactly the case that can be a
  few minutes long). The subtitle always shows the plan's real start and
  end, so a 22:00–10:00 crossing reads `22:00–10:00` on both days.
- A plan is **dragged from the day it begins on**. Its continuation is not
  draggable — moving a block whose start is off-screen is not something to
  reason about mid-drag — and the drag clamps the block's *start* to the
  day, letting its tail run past midnight.
- A **selection still may not cross midnight** (proposals spec §11): a
  proposal is one day. It does now clip at a locked plan that began the
  night before, which it previously could not see.
- Expenses and the final itinerary group by **start** day: a cost belongs
  to one row, and an itinerary entry to where it begins.

**Contest / compare screen**: shows every plan in a contest, each rendered
as an ordered stop list with per-stop time, duration, and cost, plus the
plan's totals (cost, moving time, slack) and vote count. Only pin-backed
stops are plotted on the map (travel items have no coordinates); travel
items still appear in the ordered stop list. Selecting a plan highlights its
stops on the map and draws its route. Voting and locking call
`toggleContestVote` / `lockContest`; locking navigates back to the calendar.
A locked contest's screen shows a reopen action for the owner.

## Build order

1. Backend: models, migration, schemas, `plans` and `travel-items` routers,
   derived-values logic, seed data, SSE event publishing.
2. Frontend data layer: API client functions, state shape, normalization.
3. Placement: the add bar and its sheet, placing mode, calendar grid,
   tap-to-place, move/unplace.
4. Travel items: the custom-event form and the edit UI.
5. Contests: propose-alternative sheet, compare screen, vote/lock/reopen.
6. Tests for all new endpoints and the contest-resolution logic in
   particular (locking mid-contest, reopening, overlap rejection), plus
   the `kind` set: `travel`/`lodging`/`other` accepted, the old
   flight/train/drive/ferry values rejected with a `422`, and the
   migration mapping existing rows onto `travel` while leaving `lodging`
   and `other` alone. Overnight spans too: a crossing accepted and its
   slack measured across the date boundary, the next morning occupied by
   it, a shared midnight edge not counting as a clash, a move across
   midnight, a multi-night stay holding its middle day, and an hour field
   past 24 rejected as the malformed datetime it is.
