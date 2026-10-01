import { test, expect } from "../support/fixtures.js";
import { dayUrl } from "../support/calendar.js";
import { contestsOf, plansOf, proposeBlock } from "../support/seed.js";
import { addCustomEvent, startAt } from "../support/planner.js";

// Every proposal is built in the route planner (pages/PlanTrip.jsx): from
// a day's "+ Add", a reopened draft, adding a set to a running vote, and
// editing your own set. These use stops with no spot on the map (custom
// events), which need no rides, so they run without a Maps key.

test("a day's + Add proposes a route, starting when you say", async ({ page, api, seed }) => {
  const trip = await seed();
  await page.goto(dayUrl(trip));
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: /^Propose a route/ }).click();
  await expect(page).toHaveURL(/\/map\/trip\?day=1&from=schedule/);

  await addCustomEvent(page, "Dumpling lunch");
  await startAt(page, "12", "30");
  await page.getByRole("button", { name: "Review proposal" }).click();
  await expect(page.getByText(/12:30–13:30/).first()).toBeVisible();
  await page.getByRole("button", { name: "Send to vote" }).click();
  await expect(page).toHaveURL(/\/contests\/\d+/);

  const [contest] = await contestsOf(api, trip);
  expect(contest.starts_at).toContain("T12:30");
  expect(contest.ends_at).toContain("T13:30");
  const [set] = contest.plans;
  expect(set.label).toBe("Dumpling lunch");
  expect(set.items.map((i) => i.travel_item?.title)).toEqual(["Dumpling lunch"]);
});

test("a draft reopens in the planner and can be sent from there", async ({ page, api, seed }) => {
  const trip = await seed();
  await page.goto(`/trips/${trip.id}/map/trip?day=1&from=schedule`);
  await addCustomEvent(page, "Night market");
  await startAt(page, "18", "00");
  await page.getByRole("button", { name: "Review proposal" }).click();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}/schedule/1`));

  await page.getByRole("button", { name: /^Night market · 18:00–19:00/ }).click();
  await expect(page).toHaveURL(/\/map\/trip\?draft=\d+/);
  await expect(page.getByText("Draft · only you can see it")).toBeVisible();
  await expect(page.getByRole("button", { name: "Starts at 18:00. Change" })).toBeVisible();
  // Something added while the draft is open survives the draft being
  // replaced by the proposal.
  await addCustomEvent(page, "Late snack");

  await page.getByRole("button", { name: "Review proposal" }).click();
  await page.getByRole("button", { name: "Send to vote" }).click();
  await expect(page).toHaveURL(/\/contests\/\d+/);
  // The draft became the proposal; it isn't left behind as a second copy.
  expect((await plansOf(api, trip)).filter((p) => p.status === "draft")).toHaveLength(0);
  const contests = await contestsOf(api, trip);
  expect(contests).toHaveLength(1);
  expect(contests[0].plans[0].items.map((i) => i.travel_item?.title)).toEqual(["Night market", "Late snack"]);
});

test("a set added to a vote spans the vote's hours", async ({ page, api, seed }) => {
  const trip = await seed({ events: [{ title: "Temple visit", minutes: 60 }] });
  const contest = await proposeBlock(api, trip, { from: "13:00", to: "15:00", events: [trip.events["Temple visit"]] });

  await page.goto(`/trips/${trip.id}/contests/${contest.id}`);
  await page.getByText("+ Add a set for these hours").click();
  await expect(page).toHaveURL(new RegExp(`/map/trip\\?contest=${contest.id}`));

  await addCustomEvent(page, "Tea house");
  await expect(page.getByRole("button", { name: "Starts at 13:00. Change" })).toBeVisible();
  await expect(page.getByText("Vote’s hours 13:00–15:00")).toBeVisible();
  await page.getByRole("button", { name: "Review the new set" }).click();
  await page.getByRole("button", { name: "Add as another set" }).click();
  await expect(page).toHaveURL(new RegExp(`/contests/${contest.id}`));

  const [after] = await contestsOf(api, trip);
  expect(after.plans).toHaveLength(2);
  const added = after.plans.find((p) => p.items.some((i) => i.travel_item?.title === "Tea house"));
  expect(added.starts_at).toContain("T13:00");
  expect(added.ends_at).toContain("T15:00");
});

test("editing your set rewrites it in place, and a stop too long for the vote is refused", async ({ page, api, seed }) => {
  const trip = await seed({ events: [{ title: "Temple visit", minutes: 60 }] });
  const contest = await proposeBlock(api, trip, { from: "13:00", to: "15:00", events: [trip.events["Temple visit"]] });
  const [set] = contest.plans;

  await page.goto(`/trips/${trip.id}/map/trip?contest=${contest.id}&edit=${set.id}`);
  await expect(page.getByText(/^Editing Set/)).toBeVisible();
  const timeline = page.getByRole("list", { name: "Trip" });
  await expect(timeline.getByText("Temple visit", { exact: true })).toBeVisible();

  // Five more quarter hours runs the set past 15:00.
  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "Longer at Temple visit" }).click();
  await expect(page.getByText(/past the vote’s hours, 13:00–15:00/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Review changes" })).toBeDisabled();
  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "Shorter at Temple visit" }).click();

  await addCustomEvent(page, "Tea house");
  await page.getByRole("button", { name: "Review changes" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(new RegExp(`/contests/${contest.id}`));
  await expect(page.getByText(/^Set updated/)).toBeVisible();

  const [after] = await contestsOf(api, trip);
  const edited = after.plans.find((p) => p.id === set.id);
  expect(edited.items.map((i) => i.travel_item?.title)).toEqual(["Temple visit", "Tea house"]);
});
