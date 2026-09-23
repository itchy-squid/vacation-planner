# Trip travelers, who pays, per-person prices — implementation notes

Mockups: https://claude.ai/artifact/7LHKHCQ8h8CrH4y1KL8Jgw (Sep 23, 2026).
This amends `split-party-plans-spec.md` (parties are now travelers, and a
party can be "everyone except …") and the Expenses parts of
`proposals-and-expenses-feature-spec.md` (prices are per person, and there
is no more `traveller_count`).

## The model

- **`Traveler`** (`app/models.py`) is someone going on the trip, which is a
  separate list from members (`Contributor`).
  - Fields: `name, initial, tint, contributor_id?` (the member they are, at
    most one per member), `paid_by_id?` (the traveler who pays for them;
    null means they pay their own way) and `position`.
  - Paying is one level only. Someone paid for by another can't pay for
    others, and someone who pays for others can't be paid for.
- **`Trip.traveller_count` is gone.** The count is the number of travelers.
  `TripOut` has `traveler_count` and `my_traveler_id`.
- **`heads`, `Plan.party` and `Contest.party` hold traveler ids.**
  - `heads: []` now means "whoever is on the plan it's scheduled in", not
    "everyone".
- **`party_mode`** on plans and contests is either `"only"` (exactly these
  travelers) or `"except"` (everyone but these, including anyone added
  later).
  - Everyone is `("except", [])`.
  - Two `"except"` parties always collide, because the next person added
    would be on both. Otherwise two plans collide when their members
    overlap. See `app/party.py`.
- **`cost_basis`** on pins and travel items is `"per_head"` (the default for
  new items: what one person pays) or `"group"` (one bill).
  - `derive.item_money` gives each stop its `sharer_ids`, `each_cents` and
    `total_cents`, where the sharers are the item's heads, or else the
    plan's members.
  - `PlanOut.total_cost_cents` is the sum of the totals.
  - Plans also carry `party_mode`, `party_members` and `for_everyone`, so
    the client never has to apply the party rule itself.

### Migration `a91d4c7e2f58`

- Every member becomes a traveler, in join order.
- Where the old `traveller_count` was higher than the number of members,
  placeholder travelers ("Traveler 5") are added so that no headcount
  changes.
- `heads` and `party` values are remapped from member ids to traveler ids.
- A non-empty party becomes `"only"`, and `[]` stays everyone.
- Every existing price becomes `"group"`, so no total moves.
- Invites gain `traveler_id`.
- The downgrade maps everything back and drops travelers who had no
  account.
- The round trip, with data, was tested on SQLite. It has not been tested
  on Postgres.

## Server

- **`routers/travelers.py`**:
  - `GET/POST /trips/{id}/travelers` and `PATCH/DELETE /travelers/{id}`.
  - `POST /travelers/{id}/invite {role}` makes a link that signs whoever
    accepts it in as that traveler. It stops working once that traveler is
    claimed.
  - Permissions:
    - A new scope, `travelers:manage` (planners and owners), covers adding,
      editing and removing anyone.
    - Anyone can change their own name and who pays for them.
    - Readers can view the roster.
  - `remove_traveler` removes the traveler from every group and cost
    split. A plan or decision nobody is left on is deleted, and anyone they
    paid for goes back to paying for themselves.
- **Removing a member** now only unlinks their traveler, because they're
  still going.
- **Joining** (`POST /invites/{token}/accept {traveler_id? | not_going?}`)
  claims a listed traveler, adds you as a new one, or adds nobody.
  - Claiming a traveler someone else has already claimed returns a 409.
  - The invite preview lists `unclaimed_travelers` and `invite_traveler`.
- **A new trip** lists its creator as its first traveler.
- **Split** takes `newcomers: "leave" | "stay" | "none"`, and the default
  is `"leave"`: the new group. That side is stored as `"except"`, unless
  another plan at the same hours already takes newcomers.
  - `PUT /plans/{id}/party` takes `party_mode`.
  - `POST /plans/{id}/join` moves the caller's traveler, and returns a 409
    for someone who isn't travelling.
- **Votes stay with members.**
  - For a decision that is for everyone, every voting member votes, as
    before.
  - For a decision that is for one group, only members linked to a
    traveler in that group vote. Travelers without an account never vote.
- **Seed**: Mei pays for her son Kai and her mother, Grandma Hua, who have
  no accounts. Priya plans but isn't going. The day-7 lake group takes
  newcomers.
- **Tests**: `tests/test_travelers.py` (18 new tests), with the split,
  costing, permission and account-deletion tests updated. All 211 backend
  tests pass.

## Frontend

- **State**:
  - `state.travelers` and `useMyTraveler()`.
  - Plans carry `partyMode`, `partyMembers`, `forEveryone`, and per item
    `sharerIds`, `eachCents` and `totalCents`.
  - Pins and travel items carry `costBasis`.
  - `lib/party.js` works on plans rather than raw lists: `partiesMeet`,
    `planIncludes`, `membersOf` and `takesNewcomers`.
- **Roster** (`components/travelers/TravelerRoster.jsx` and
  `TravelerSheet.jsx`):
  - Appears in Trip settings, where it replaces the Travellers number, and
    on Trip info.
  - Travelers are grouped into households by who pays, and show On app,
    Listed or Invited.
  - Adding a traveler asks for a name, who pays for them, and whether to
    just list them or invite them.
  - Members who aren't going are listed under "Planning, not going", with
    an "Add as traveler" button.
  - Every row you can change has a chevron. Tapping it opens **Edit
    traveler**, which has the same fields as Add a traveler: name, who pays,
    and whether they're on the app (not on the app / invite them / they're
    already a member). On an existing traveler, "not on the app" unlinks
    their account, which stays on the trip. Edit also has Remove. Someone
    editing their own row sees only name and who pays.
- **Join screen**: "Are you one of these travelers?", with options to pick
  a listed traveler, say you're new, or say you're not going. A link made
  for one traveler just shows who you'll be.
- **Split sheet**: "Anyone added to the trip later joins: This plan / The
  new group / Neither", with the new group as the default.
  - Who's going says whether this group takes newcomers, with a toggle to
    change it.
  - The grid marks that group's faces with `+NEW`.
- **Cost fields**: `components/forms/CostField.jsx` adds a Per person / For
  the group switch to the visit editor, the custom event form and the
  propose screen's stop form.
  - `HeadsPicker` now offers travelers, and its default is "Whoever's on
    the plan".
- **Expenses**:
  - A "Showing" picker offers What I'm paying (the default), Just me,
    Everyone, or any single traveler. The choice is remembered on the
    device.
  - Rows read "$12 each · 5 people" and show your part next to the whole
    bill.
  - The summary breaks the total down per traveler, which is useful for
    settling up.
- Groups everywhere (grid faces, Just me, itinerary, compare banner, voters
  on the propose screen) are made of travelers.

## Decisions taken (the mockup's suggested answers)

- Who pays is stored on the traveler. Expenses also offers a picker to
  view anyone's costs.
- The payer covers all of a traveler's costs. There are no per-item
  exceptions.
- Joining makes you a traveler unless you choose "I'm not going".
- Existing prices become group prices and keep their numbers.
- Travelers without an account don't vote.
- "Neither" is offered as a third choice for where newcomers go.

## Known gaps

- The migration hasn't been tested on Postgres 16.
- A traveler's initial comes from the first letter of their name (so
  "Grandma Hua" gets "G"), and there's no way to override it.
- The general invite list still offers a traveler who has their own
  pending link, so whoever opens the general link first can claim them.
- A planner who isn't going has no "What I'm paying" view. Their Expenses
  screen opens on Everyone.
- There's still no frontend test suite. The screens were checked by hand
  against the seed.
