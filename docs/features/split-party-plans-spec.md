# Split-party plans — implementation notes

Lets part of the group do something different over the same hours: Ana and
Lin on the Taroko Gorge trail from 08:00 to 11:00 while the other four bike
Liyu Lake, then everyone back together at the night market.

Mockups: https://claude.ai/artifact/4sKjE7Eh5ybMnsXXpCEA2g (Sep 23, 2026).
Amends `proposals-and-expenses-feature-spec.md` and
`candidate-sets-and-times-spec.md` where called out.

## The model

`Plan.party` and `Contest.party` are JSON lists of contributor ids, and
`[]` means everyone. That's the same convention `Pin.heads` uses. Two plans
may share hours only if **nobody is on both**:

```
parties_meet(a, b) = a == [] or b == [] or set(a) & set(b)
collides(p, q)     = hours overlap and parties_meet(p.party, q.party)
```

A split isn't stored anywhere. It's simply two plans for different people
at the same time, and the day grid draws a split wherever it finds that.

Parties are always stored normalized (`app/party.py normalize_party`):
sorted, de-duplicated, and `[]` when the list covers the whole roster. So
comparing parties is plain list equality, and someone who joins the trip
later is automatically on every plan for everyone.

Migration `f3a8d2c61b90` adds both columns with a server default of `[]`,
so no backfill is needed. On downgrade it deletes every plan and contest
that isn't for everyone, because the old overlap rule can't represent them.

## Server

- **Overlap** (`routers/plans.py`): `find_overlapping_plan(s)` takes a
  `party`. The time filter stays in SQL and the party test runs in Python,
  because JSON containment is written differently on SQLite and Postgres,
  and a trip has only a handful of plans in any window. A 409's
  `occupied_detail` names who's double-booked in `message` ("Lin is
  already on Wild Boy trail loop then.") and in `double_booked`.
- **`POST /plans/{id}/split`** `{ leaving, label? }` (`plans:write`): the
  people leaving come off this plan and get a new, empty plan over the
  same hours. It's one transaction and returns `[this, new]`.
- **`PUT /plans/{id}/party`** `{ party }` (`plans:write`): sets who a plan
  is for. Sending `[]` brings a branch back together with everyone, which
  409s by name until the other branch's plans in those hours are gone.
- **`POST /plans/{id}/join`** (`plans:join`, new, companions and up):
  moves the caller alone onto this group, off whatever they were on at the
  same time. It refuses if that would leave another group empty.
- All three refuse contested plans ("settle the vote first") and locked
  ones ("the owner has to reopen it").
- **Contests** (`routers/contests.py`): `ContestProposeCreate.party`.
  `open_block_contest` only looks at plans whose party meets the
  proposal's, and refuses (409, naming whose) if any of those plans is for
  a *different* party than the proposal. One "on the board" option can't
  hold two groups' days. Each group can run its own vote over the same
  hours. Options, the incumbent and the plans placed by `pick_set` all
  inherit the contest's party. `contributor_count` and the majority count
  only voting-role members of the party, and `toggle_vote` 403s anyone
  outside it. Drafts carry a party through publish.
- **Members leaving** (`routers/sharing.py _strip_from_parties`): the
  person is removed from every party. A plan or contest nobody is left on
  is deleted, and a party that now covers everyone who's left becomes `[]`.
- **Seed**: Taiwan day 7 (Hualien) is a split day.
- **Tests**: `tests/test_split_party.py` (23 tests).

## Frontend

- `lib/party.js`: `partyKey`, `partiesMeet`, `planIncludes`,
  `partyMembers`, `namesOf`.
- **Day grid** (`lib/dayGrid.js`): `layoutDayPlans` divides each cluster
  into one lane per party and packs columns inside each lane, so a vote
  inside one group widens that group's lane only. `splitBandsFrom` gives
  the dashed "Group split · 4 + 2" bracket. `PlanBlock` shows the faces of
  a plan's party (collapsed to one face and a count at three or more
  columns). An **Everyone / Just me** switch appears on split days, and in
  Just me the bracket reads "Ana and Lin elsewhere".
- The drag-to-move overlap check honours parties.
- **Who's going** (`components/planner/WhoIsGoing.jsx`, in
  `PlanDetailsSheet`) offers Split the group, Change who's going, Bring
  everyone back, and Join this group. It also lists what the other groups
  are doing over the same hours.
- **Proposals** (`ProposeBlock`): the block's party comes from the
  contest, then a reopened draft, then `location.state.party`, then the
  hours themselves. If the hours hold one group's plans, the block is for
  that group, and if they hold several, it's for yours. The board column,
  set letter, clash detection and vote card are all scoped to that party.
  The quick-propose sheet uses the party of the plan it was opened on.
- **Compare**: a banner names the group the decision is for, and voting is
  hidden for anyone outside it.
- **Expenses**: `headcountFor(item, trip, contributors, party)` falls back
  to the plan's party before `traveller_count`. Rows only other people
  share are dimmed and left out of your share.
- **Final itinerary**: My itinerary (the default once any plan has a party)
  shows your stops, "with Jae, Theo and Priya", and one line per other
  group. The Whole group view shows every stop with whose it is.

## Decisions (from the mockup's open questions)

1. Parties are made of contributors, not travellers.
2. People left out of both groups are allowed. The UI shows who is
   elsewhere but doesn't block anything.
3. Companions can move themselves between groups (`plans:join`).
4. Splitting isn't put to a vote: a planner splits the group.
5. There are no multi-day splits; each day's plans carry their own party.

## Known gaps

- There's no single "merge" action. Bringing a group back is: remove the
  other group's plans, then choose Bring everyone back.
- The step-2 hour picker still clips at *any* locked plan, including one
  for another group. The server only refuses locked plans for the
  proposal's own party.
- Placing a new item from the add sheet always creates a plan for
  everyone. Tapping into one group's hours opens the propose sheet for
  that group rather than placing the item for it directly.
- The migration round trip was tested on SQLite only, not on Postgres 16.
- There's still no frontend test suite. The screens were checked by hand
  against the seeded split day.
