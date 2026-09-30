# Route proposals — every proposal is built on the map

Replaces the four-step "Propose a block" flow (pick hours, fill them,
review) from `proposals-and-expenses-feature-spec.md` §5. Every proposal
is now built in the route planner, `pages/PlanTrip.jsx`: stops in order,
a ride between each pair, timed from when the proposal starts. Mockup:
`Claude outputs/route-proposal-mockup.html`.

## Ways in

All go to `/trips/:tripId/map/trip`, with the reason in the query string
so a reload lands in the same place:

| From | URL | Back goes to |
| --- | --- | --- |
| An idea's "Directions" on the Map tab | `?to=<pin id>` | Map |
| A day's **+ Add → Propose a route** | `?day=<n>&from=schedule` | That day |
| A draft in the day's tray | `?draft=<plan id>` | That day |
| **+ Add a set for these hours** on a vote | `?contest=<id>` | The vote |
| **Edit** on your set in a vote | `?contest=<id>&edit=<plan id>` | The vote |

The old `/trips/:tripId/schedule/:day/propose` redirects to the day's
planner.

## Starts

The **Starts** field sits next to the day and opens a sheet with:

- quick picks from the day's open stretches ("After National Palace
  Museum"), including the group's own time apart on a split day
- any hour 06–23, and minutes on the calendar's 15-minute grid.

A new route starts at the first open stretch from 08:00 that fits it, not
09:00. If a stop is already on the calendar, the route is timed around it
and Starts is locked, with a note naming the stop. A day strip (06–24)
shows the route against what's already on.

## Stops

**+ Add a stop** offers: tap a place on the map; pick from the ideas list
(ideas and custom events not yet scheduled, including ideas with no map
spot); or make a custom event (name, length, cost).

A stop with no place on the map (a custom event, or an idea with no spot)
happens where the group already is, so no ride goes to it; the next ride
leaves from the last stop with a place (`lib/tripPlan.js rideLegsOf`).
A route can be a single stop with no ride.

**Edit** on a stop sets its length and cost (per person or for the
group). The cost is saved to the idea or event itself, as it is
everywhere else. The planner and review show the cost per person and in
total, fares included (`tripMoney`).

## Who it's for

A route inside a split is for one group: the one picked with the group
buttons, else the viewer's own. Anything outside a split is for everyone.
Only that audience's plans are in its way. A route that crosses a split's
edge can't go to review, and the planner says why and what to change
(`splitEdgeProblem`), e.g. "This runs past the split. Lake's time apart
ends at 12:00, but this gets back at 12:30…".

## Votes, drafts and editing

- **Adding a set** fixes the day and the vote's hours; the route must fit
  inside them (a dashed frame on the strip, with minutes to spare or
  over). The set is sent with the vote's exact hours, so it joins it.
- **Editing a set** is the same, and saves in place (`PUT
  /api/plans/{id}/stops`), clearing its votes. **Withdraw this proposal**
  asks for a second tap.
- **Drafts** reopen with their stops, rides, start and name. Sending or
  re-saving replaces the draft; **Delete draft** discards it.
- A new route whose hours exactly match a running vote joins it; one that
  partly overlaps a running vote is refused with the vote's hours named.

Saved blocks come back as routes (`fromItems`): rides aren't stops, and a
block that opens or closes with a ride started or ended where the group
was staying.

## Not carried over from the block screen

- Free time between stops: a route packs its stops, so an old set with
  gaps loses them if it's edited.
- The "most hearted" ordering in the pull-in list.
- A custom event can't be given its own place on the map (travel items
  have no location); it always happens at the stop before it.
