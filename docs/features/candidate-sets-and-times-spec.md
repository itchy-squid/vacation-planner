# Candidate sets and their times — implementation spec

Amends `proposals-and-expenses-feature-spec.md` (§5.3, §5.4, §6.2, §7, §8)
and, through it, `scheduling-feature-spec.md`. Every amendment is called
out inline as **(amends proposals spec)**.

Two additions, both about a decision that is already running:

1. **Add a set to an open block** — a second, third, *n*th candidate for
   hours that are already out for a vote, asked for from the compare
   screen rather than by re-dragging the same window by hand.
2. **Re-time a candidate's stops** — explicit start times for the stops
   inside one option, so a proposal can say "the museum at 14:00, dinner
   at 17:00" and mean the two hours between them.

Neither needs a migration. Both were *nearly* possible already, and the
shape of what was missing is the interesting part of each.

---

## Overview

The window contest has always accepted a further option: a proposal whose
window matches an open contest's **exactly** attaches to it instead of
opening a second one (proposals spec §6.2 step 2), which is the rule that
makes a `SET C` possible at all. What was missing was a way to *ask* for
that. The only route in was the hour picker — drag the same hours again
and hope both edges land on the same two 15-minute boundaries; miss by one
and you get the partial-overlap 409 instead of the thing you wanted. So
addition 1 is entry points and no new server path.

Likewise, `PlanItem.offset_minutes` has existed since the proposals
feature: the capture writes it so a 14:00 dinner swept into a 13:00–18:00
window still reads 14:00 (proposals spec §6.2 step 4). But nothing a
*person* built could ever set it — a proposal's stops pack end to end from
the window start, with `offset_minutes` NULL, and that packing is what
makes two stops overlapping impossible to express (§5.3). Addition 2 gives
that column a second writer, and takes on the overlap check that packing
used to make unnecessary.

---

## Decisions

| # | Question | Decision | Why |
|---|----------|----------|-----|
| 1 | Where does "add a set" start from? | **The compare screen**, under the option cards | It is the screen that shows the decision, the hours, and what everyone else has already suggested — which is what you need in front of you to decide that a further set is worth writing |
| 2 | Does adding a set re-run the capture? | **No.** The capture happens once, when the contest opens | Re-running it would fold the existing options into a new incumbent, so the decision would quietly change shape every time someone joined it |
| 3 | Do stops keep packing end to end? | **No — explicit offsets, gaps allowed** | Packing cannot express deliberate free time inside a block, which is most of what "when does this happen" means. See §3 for what is checked in its place |
| 4 | Can the incumbent be re-timed? | **No** | The set on the board is not a proposal anyone wrote; it is the status quo the group is being asked whether to keep. Editing it edits the question |
| 5 | What happens to votes cast for a re-timed set? | **Cleared, and said out loud** | A vote for "ruins first, beach after" is a vote for an arrangement of hours as much as for a list of places. Keeping the tally would leave someone backing hours they never saw |
| 6 | Who may re-time a set? | **Its proposer, or the trip owner** | Matches locking: the owner can act on any option, everyone else only on their own |
| 7 | Does re-timing move the plan's own hours? | **Never** | Every option in a contest spans exactly the contest's window. Moving one would break the comparison the contest exists to make, and would need the whole overlap-against-other-plans check `move_plan` does |
| 8 | Is "save draft" offered when joining a vote? | **No** | A draft is hours nobody has claimed. These hours are out for a vote that may be locked before the draft is published, so a private copy is a way to lose work rather than keep it |

---

## 1. Data model

**Unchanged.** `PlanItem.offset_minutes` and `PlanItem.duration_minutes`
already exist and already mean exactly what is needed (proposals spec §1).
No migration, no new columns, no enum values.

The only change in meaning is who writes `offset_minutes`: previously the
capture alone, now the capture and `PATCH /api/plans/{id}/timing`.

---

## 2. Derived values

**Unchanged**, and deliberately so. `item_start` already prefers an
explicit offset over packing (proposals spec §2), so every screen that
reads `start_minute_of_day` — Expenses, the compare stop lists, the final
itinerary — picks up re-timed stops with no change at all.

One consequence worth stating, because it looks like a bug the first time
someone sees it:

```
slack_minutes = range_minutes - sum(item_duration(i) for i in items)
```

is measured against the *stops*, not their span. A block with two hours of
deliberate gap in the middle reports those two hours as slack, exactly as
it would if the same gap sat at the end. That is right — slack has always
meant "unplanned time inside the claimed hours" — and it means a
well-arranged day and a half-empty one can report the same number. The
arrangement is visible in the stop list; the number is about how full the
block is.

---

## 3. Server behavior

### 3.1 Adding a set

**(amends proposals spec §6.2)** No change to `open_block_contest`. The
exact-window match at step 2 is the whole mechanism; this feature only
guarantees the client asks with the contest's own `starts_at`/`ends_at`
rather than with whatever the drag produced.

Worth naming what the existing path already does, since it is now reachable
on purpose rather than by coincidence:

- the contest is **not** re-created and the capture is **not** re-run
  (decision 2);
- the new option is lettered by `created_at`, so it is simply the next
  letter after the current options — A stays the board;
- the window check still runs, so a set added into hours that were locked
  in the meantime gets the same 409 a fresh proposal would.

### 3.2 Re-timing — `PATCH /api/plans/{plan_id}/timing`

**(new)** Body:

```
{ items: [{ position, offset_minutes, duration_minutes }] }
```

`position` names each stop **as it stands now**; the payload must cover
every stop in the plan exactly once. `duration_minutes` is the stop's
*effective* length, not an override — the server stores it on the
`PlanItem` only when it differs from the pin's or travel item's own
duration. That is what lets a trim be undone: set the length back to the
item's own and the override goes away. A nullable "override or nothing"
field could not express the difference between "leave it alone" and "clear
it" without a second flag.

Refused with a **409** unless:

- the plan's status is `contested` and it belongs to an open contest — a
  placed plan is moved with `PATCH /api/plans/{id}`, and a locked one is
  reopened first;
- the plan has an author (`created_by_id` is not NULL) — the incumbent is
  the capture's own work, not anyone's proposal (decision 4);

and **403** unless the caller is that author or the trip owner
(decision 6). **400** if the payload does not cover every stop exactly
once.

Then, with the stops sorted by `offset_minutes`:

- no stop may start before the one before it has finished — the check that
  replaces the packing guarantee (decision 3);
- no stop may run past `ends_at - starts_at`;
- `duration_minutes >= 15`, matching the stepper everywhere else.

Both refusals name the stop, and the overlap one names the stop it
collides with, so the sheet can say the sentence rather than "invalid".

On success: offsets and durations are written, **positions are renumbered
into time order** (a stop dragged past another reorders the set — the list
a voter reads top to bottom is the order the day happens in), every `Vote`
for that plan is deleted (decision 5), and the whole `ContestOut` is
returned so the tally on screen changes with the times.

---

## 4. API

New:

- `PATCH /api/plans/{plan_id}/timing` → `ContestOut`. Body as §3.2.
  409 detail carries `{ message, stop_title }` for an overlap or an
  overrun, and `{ message, plan_id }` for the incumbent.

Changed: nothing. `POST /api/trips/{trip_id}/contests` is unchanged, and
`ContestOut`/`PlanOut` already carry `offset_minutes` and
`start_minute_of_day`.

---

## 5. Realtime events

**(amends proposals spec §8)**

- `plan.retimed` *(new)* — `{ plan_id, contest_id, votes_cleared }`. Open
  compare screens refetch; the day grid needs no change, since the plan's
  own hours have not moved.

---

## 6. Frontend

### 6.1 Add a set — `pages/CompareSets.jsx`

A dashed, full-width **`+ Add a set for these hours`** button under the
option cards, hidden once the contest is resolved. It navigates to the
propose flow with `state: { joinContestId }`.

Dashed and quiet on purpose: it is an addition to a decision in progress,
not the decision.

### 6.2 Join mode — `pages/ProposeBlock.jsx`

**(amends proposals spec §5.2)** A third way into the flow, beside a fresh
proposal and a reopened draft. With `joinContestId`:

- the contest is fetched, and its window becomes the selection **to the
  minute** — anything less exact lands in the partial-overlap 409 rather
  than on the decision it meant to join;
- the flow opens on **step 3**; step 2 is unreachable, and its back button
  becomes `Cancel`, returning to the compare screen;
- the nav guard arms on stops alone. A selection the user dragged is work
  worth guarding; one handed to them by the contest they are joining is
  not;
- step 4's **on the board** column shows the contest's option A — not
  every stop in the window, which on this path would be every candidate's
  stops merged into one unreadable column;
- the set letter is the next one after the contest's current options,
  computed with the same spreadsheet-style run the server uses
  (`_set_letter`), so the review card predicts the letter the card comes
  back with;
- `Save draft` is gone (decision 8) and `Send to vote` reads **Add to the
  vote**.

### 6.3 Re-timing — `components/planner/PlanTimingSheet.jsx`

**(new)** A bottom sheet over the compare screen, built like
`PlanDetailsSheet` (backdrop plus rounded-top panel) so the screen
underneath keeps its scroll position. Opened from an **Edit times** action
in the expanded `SetCard`, shown only to someone who may actually use it.

Each stop gets a `Starts` stepper and a `How long` stepper, both 15m.
Between the rows, a line of its own for the gap — `45M FREE`, or
`30M OVERLAP` in the warn colour. Gaps are the reason the sheet exists, so
they are not left as a subtraction for the reader to do between two clock
times.

Rows keep their order in state and are sorted only for display, so a stop
dragged past another does not move the steppers out from under the finger
that is editing it. Moving one stop moves only that stop; dragging the rest
along would be a second, different gesture ("shift the afternoon"), and
guessing which one was meant is how an edit to one row quietly rewrites
four.

The first problem with the arrangement is stated live, in the same words
the server would use, and the save is disabled until it is gone. One
message rather than a list: fixing the first almost always changes what the
rest would have said.

If the set has votes, the sheet says so **before** the save, not after:
clearing someone else's vote is the kind of thing to be warned about while
there is still the option of not doing it. After the save, the compare
screen carries a one-line notice, because a tally that drops to zero with
no explanation reads as a bug.

### 6.4 State

`state/PlannerContext.jsx` gains one action, `RETIME_PLAN`, which calls the
endpoint and refreshes plans. A 409 here is a real answer rather than a
crash — the detail names the stop — so it comes back as
`{ ok: false, error }` for the sheet to say out loud.

`lib/api.js` gains `retimePlanItems(planId, items)`.

---

## 7. Validation and edge cases

- Every stop covered exactly once; partial re-timing is a 400.
- `offset_minutes >= 0`; `offset + duration <= window`; `duration >= 15`.
- Stops may not overlap once sorted by offset. Touching edges are fine —
  the same rule as everywhere else in the app.
- A gap is legal anywhere, including before the first stop, and counts as
  slack (§2).
- Re-timing the winning option and then locking it keeps the offsets: the
  day the group agreed to is the day the calendar then shows.
- Adding a set to a contest that was locked while the flow was open gets
  the existing 409, and the client reopens the hour picker with that
  message — the same path a stale draft publish already takes.
- The window itself is never editable here. Changing the hours under a
  running vote is a different feature, and a destructive one.

---

## 8. Tests

`backend/tests/test_candidate_set_times.py` (15 tests):

- a third set joins without re-capturing the board; every option spans one
  window;
- explicit offsets move stops and leave the gap as slack; positions follow
  the clock;
- overlap and overrun refused, by name; partial payload refused;
- a stop set back to its item's own length clears the trim;
- votes cleared for that set only; `majority_plan_id` recomputed after;
- author and owner may re-time, a third contributor may not;
- the incumbent, a locked decision, and a placed plan are all refused;
- re-timed stops survive a lock.

---

## 9. Known gaps

- Still no frontend test suite, so §6 is covered by reading and by the
  build, not by tests.
- No "shift the whole set" gesture (§6.3). Moving three stops by half an
  hour is three edits.
- The sheet's steppers are 15m taps; there is no drag-on-a-grid version of
  re-timing, which is what the hour picker does for the window.
- `plan.retimed` is published, but nothing on the frontend subscribes to
  the trip's SSE channel yet — no screen does, for any event — so it joins
  the rest as something for a live-sync pass. The compare screen refetches
  on its own action instead, and a second viewer sees the change on their
  next load.
