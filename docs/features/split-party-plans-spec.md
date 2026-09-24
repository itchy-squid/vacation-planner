# Split-party plans — implementation notes

This covers part of the group doing something different over the same hours.
For example, Ana and Lin take the Taroko Gorge trail from 08:00 to 11:00 while
the others bike Liyu Lake, and then everyone meets at the night market.

Mockups: https://claude.ai/artifact/4sKjE7Eh5ybMnsXXpCEA2g (Sep 23, 2026).
Amends `proposals-and-expenses-feature-spec.md`,
`candidate-sets-and-times-spec.md` and `trip-travelers-spec.md` where
called out.

## History

The first version (Sep 23, 2026) had no split record. Every plan and contest
carried a `party` (traveler ids read through `party_mode`), and a split was
inferred wherever two plans for different people shared hours. That made
every operation on a split as a whole fragile:

- **"Bring everyone back" returned 409 whenever the other group still had
  plans.** It only re-partied one plan. Nothing could merge a split.
- **The proposal hour picker couldn't claim hours during a split.** It
  clipped at *any* pinned plan, and it guessed the audience from the
  selection, which it also used to decide what to clip at.
- **Tapping into split hours while placing did nothing.** Blocks covered
  the lanes, and a tap on a block while placing was ignored.

Every screen re-derived the split in its own way. The model below replaces
that (Sep 24, 2026, migration `d52b8e1f7a93`).

## The model (`backend/app/splits.py`)

- **`Split`**: a trip, `starts_at`, `ends_at`.
- **`SplitBranch`**: one group of a split, with `label`, `position`,
  `traveler_ids` (exactly who is in it) and `takes_newcomers` (at most one
  per split).
- **`Plan.branch_id`, `Contest.branch_id`**: the group a plan or decision
  is for. `None` means everyone. `party` and `party_mode` are gone.

Three rules, kept in `app/splits.py`:

1. Splits on a trip never overlap.
2. A plan or contest in a branch lies inside its split's hours. A plan for
   everyone never overlaps a split (`resolve_branch`, used by every path
   that claims time). A refusal is a 409 carrying `split_id`.
3. So two plans collide exactly when their hours overlap **and they have
   the same `branch_id`** (both `None` included). That's a plain SQL
   filter (`routers/plans.py _overlapping`).

A split has at least two groups, and nobody is in two of them. Someone in
no group is allowed and shown as "free, in neither group".

## API

| Call | Scope | What it does |
| --- | --- | --- |
| `GET /api/trips/{id}/splits` | plans:read | Every split on the trip, with its groups |
| `POST /api/trips/{id}/splits` `{starts_at, ends_at, branches, keep_plans_with}` | plans:write | Splits the group. The plans already in those hours go to the group at `keep_plans_with`. |
| `PUT /api/splits/{id}` `{branches}` | plans:write | Says who is in which group, as the whole assignment at once. Existing groups are named by `id`, new ones have no `id`, and a group that's left out is removed (only if it has nothing planned). |
| `PUT /api/splits/{id}/hours` `{starts_at, ends_at}` | plans:write | Changes when the split starts and ends. Nothing changes hands. |
| `POST /api/splits/{id}/merge` `{keep_branch_id}` | plans:write | Brings everyone back. The kept group's plans and votes become everyone's, and the other groups' plans come off the calendar the same way an unplace does. |
| `POST /api/branches/{id}/join` | plans:join | Moves the caller's own traveler into this group. Returns the split, or `null` if the move ended it. |

Placing, moving, proposing and drafts take a `branch_id`. `PlanOut` and
`ContestOut` carry `branch_id`, `party_members` (the travelers it's for
right now) and `for_everyone`.

What gets refused, and why:

- **Splitting** is refused over a plan only partly inside the hours, over a
  vote in progress, or over a pinned plan. A pinned plan was pinned for
  everyone, so the owner reopens it before it can become one group's.
- **Changing a split's hours** (`retime_split`) is refused when the new
  hours would leave any group's plan or vote outside them, take in a plan
  or vote for everyone, or overlap another split. Unlike splitting, it
  never hands plans to a group: move the thing in the way first. The 409
  names it and carries its `plan_id` (or the other split's `split_id`).
- **Merging** is refused while another group has a pinned plan or a vote
  in progress. The message names it.
- **Joining** is refused when it would leave a group that has plans with
  nobody in it. A group left empty with nothing planned is removed. A split
  left with one group dissolves, and its plans become everyone's.
- **Votes**: only a group's travelers vote on its decisions
  (`voter_ids`). Someone who moves out of a group loses their vote there.
- **Travelers.** Someone added to the trip joins every group that takes
  newcomers (`add_newcomer`, called from `add_traveler`). When someone is
  removed from the trip, they're taken out of every group. A group left
  with nobody goes, along with its plans, and a split left with one group
  dissolves.

## Migration `d52b8e1f7a93`

Existing splits are rebuilt from the parties. For each trip, plans that
aren't for everyone are clustered by overlapping hours (drafts left out).
Each cluster becomes a split over its hours, with one group per distinct
party.

- If no party took newcomers and some travelers were on none of the
  parties, those travelers get a group of their own.
- A cluster that turns out to be one party covering everyone is not a
  split, and its plans become plans for everyone.
- Contests and drafts join the group with their party whose split contains
  their hours.

The downgrade writes each group back onto its plans and contests as a party.
The group that took newcomers becomes "except everyone else". The round trip
was tested on SQLite, **not on Postgres**.

## Frontend

- **`lib/splits.js`** replaces `lib/party.js`. State carries `splits`
  (loaded with the trip and refreshed with the plans).
- **Day grid** (`lib/dayGrid.js splitLanes` and `layoutDayPlans`). Each
  split's hours are divided into one lane per group, in the split's own
  order. An empty group still gets a lane, named at its foot. A group's
  plans pack into its lane, and plans for everyone pack across the full
  width.
  - While placing, a tap in a lane places the item for that group, and a
    tap on a block counts as a tap at that time in that block's group.
  - Dragging a plan outside its split, or dragging a plan for everyone into
    a split, is refused with a message saying why.
  - "Just me" keeps only your group's lane.
  - Each edge of a split that falls on the day has a grip
    (`SplitEdgeHandle.jsx`), for planners (`plans:write`) when not placing.
    Dragging it moves that edge in 15-minute snaps, and the outline, lanes
    and caption follow live. On drop, `lib/splits.js splitHoursProblem`
    runs the server's checks against the day's plans and shows the same
    sentence, so a refused drag says why without a round trip.
- **Propose, step 2** (`lib/windowClaim.js`, `WindowSelection`).
  - The drag picks who the block is for from where it starts. Inside a
    split it's for a group: yours by default, and the chips under the grid
    switch it. Anywhere else it's for everyone.
  - A block for a group can only reach its split's hours and clips only at
    that group's own pinned plans. A block for everyone clips at splits.
  - The selection covers only the group's lane.
- **Who's going** (`WhoIsGoing.jsx`).
  - A plan for everyone offers Split the group.
  - A plan in a group shows the group and what the other groups have
    planned. It offers Join this group, Change who's going, where
    newcomers go, and Bring everyone back. Bring everyone back names what
    will come off the calendar before anything changes.
- **Compare, Expenses, Final itinerary**: unchanged in behaviour. They read
  `party_members` and `for_everyone`, and the itinerary groups other people's
  plans by `branchId`.
- **`lib/api.js`** now keeps an error's parsed body. It used to try to
  re-read an already consumed body, so `err.body` was always null and every
  409-detail branch (open the propose sheet, jump to the running vote, name
  the clash) was dead.

## Tests

- **Backend**: `tests/test_splits.py` (45 tests) covers where plans may go,
  splitting, changing a split's hours, reshaping, joining, merging, votes inside a group, and travelers
  joining or leaving the trip. `tests/test_travelers.py` covers newcomers and
  costs.
- **End to end**: `e2e/tests/splits.spec.js` covers five flows. They are
  splitting from a plan, placing into one group's lane while both groups are
  busy, proposing a block for one group during a split (the reported bug),
  dragging a split's edges (including both refusals), and bringing everyone
  back.

## Decisions

1. A party is made of travelers (see `trip-travelers-spec.md`).
2. Someone in no group is allowed and shown, not blocked.
3. Companions can move themselves between groups (`plans:join`).
4. The group doesn't vote on whether to split. A planner splits it.
5. No multi-day splits are designed, though nothing in the model forbids
   them.
6. Moving people between groups is allowed even when a group has a pinned
   plan. Pinning fixes the time, not who goes.

## Known gaps

- A split's edges are dragged one at a time; the whole split can't be
  slid to other hours in one move. A split's edge can only be dragged on
  the day it falls on.
- Splitting starts from a plan's details sheet, so a split can't yet be
  made over empty hours from the UI (the API allows it).
- The migration hasn't been run against Postgres.
- A group's lane name sits at the lane's foot and is hidden when the
  group's plans fill the lane.
