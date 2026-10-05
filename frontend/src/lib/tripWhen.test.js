// Run with `npm test` (Node's built-in test runner, no dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import { dayTime } from "./planTime.js";
import {
  addDays,
  dayContents,
  defaultMove,
  lengthOf,
  movePreview,
  movedWords,
  outsideTrip,
  startMovedBy,
  whenFields,
  whenOf,
} from "./tripWhen.js";

const plan = (day, startMin = 540, endMin = 600) => {
  const startsAt = (day - 1) * 1440 + startMin;
  const endsAt = (day - 1) * 1440 + endMin;
  return { startsAt, endsAt, startDt: dayTime(startsAt), endDt: dayTime(endsAt) };
};

test("dates and lengths turn into the API's fields", () => {
  assert.deepEqual(whenFields({ mode: "rough", lengthDays: 5, roughMonth: 3, startDate: "2027-03-12" }), {
    start_date: null,
    end_date: null,
    length_days: 5,
    rough_month: 3,
  });
  assert.deepEqual(whenFields({ mode: "dates", startDate: "2027-03-12", endDate: "", lengthDays: 5 }), {
    start_date: "2027-03-12",
    end_date: null,
    length_days: null,
    rough_month: null,
  });
});

test("a trip planned by length opens on its length; one with dates on its dates", () => {
  assert.equal(whenOf({ startDate: null, lengthDays: 5, roughMonth: 3, dayCount: 5 }).mode, "rough");
  const dated = whenOf({ startDate: "2027-03-12", endDate: "2027-03-16", dayCount: 5 });
  assert.equal(dated.mode, "dates");
  assert.equal(dated.lengthDays, 5);
  assert.deepEqual(whenOf(null), { mode: "dates", startDate: "", endDate: "", lengthDays: 5, roughMonth: null });
});

test("only a move from one date to another moves day 1", () => {
  assert.equal(startMovedBy("2027-03-12", "2027-03-19"), 7);
  assert.equal(startMovedBy("2027-03-12", "2027-03-11"), -1);
  assert.equal(startMovedBy(null, "2027-03-12"), 0);
  assert.equal(startMovedBy("2027-03-12", null), 0);
  assert.equal(lengthOf("2027-02-27", "2027-03-02"), 4);
  assert.equal(addDays("2027-02-28", 1), "2027-03-01");
});

test("moves read as words", () => {
  assert.equal(movedWords(7), "a week later");
  assert.equal(movedWords(14), "2 weeks later");
  assert.equal(movedWords(-1), "1 day earlier");
  assert.equal(movedWords(3), "3 days later");
});

test("the prompt starts on shift unless the length changed", () => {
  assert.equal(defaultMove(5, 5), "shift");
  assert.equal(defaultMove(5, 6), "keep_dates");
});

const CONTENTS = dayContents([plan(1), plan(1), plan(2), plan(5)], { 1: { stay: "Kyoto", visits: [] }, 4: { stay: null, visits: ["Nara"] } });

test("shifting keeps each day's things on the same day of the trip", () => {
  const { rows, setAside } = movePreview({ contents: CONTENTS, oldStart: "2027-03-12", newStart: "2027-03-19", newLength: 5, how: "shift" });
  assert.deepEqual(
    rows.map((r) => [r.day, r.date, r.contents?.plans ?? 0, r.fromDate]),
    [
      [1, "2027-03-19", 2, "2027-03-12"],
      [2, "2027-03-20", 1, "2027-03-13"],
      [3, "2027-03-21", 0, null],
      [4, "2027-03-22", 0, "2027-03-15"],
      [5, "2027-03-23", 1, "2027-03-16"],
    ]
  );
  assert.equal(rows[0].contents.stay, "Kyoto");
  assert.deepEqual(setAside, []);
});

test("keeping dates sets aside whatever the new dates leave out", () => {
  const { rows, setAside } = movePreview({ contents: CONTENTS, oldStart: "2027-03-12", newStart: "2027-03-14", newLength: 5, how: "keep_dates" });
  assert.deepEqual(
    rows.map((r) => [r.date, r.contents?.plans ?? 0]),
    [
      ["2027-03-14", 0],
      ["2027-03-15", 0],
      ["2027-03-16", 1],
      ["2027-03-17", 0],
      ["2027-03-18", 0],
    ]
  );
  assert.equal(rows[1].contents.stay, "Nara");
  assert.deepEqual(
    setAside.map((s) => s.date),
    ["2027-03-12", "2027-03-13"]
  );
});

test("adding a day at the start keeps everything with an empty first day", () => {
  const { rows, setAside } = movePreview({ contents: CONTENTS, oldStart: "2027-03-12", newStart: "2027-03-11", newLength: 6, how: "keep_dates" });
  assert.equal(rows[0].contents, null);
  assert.equal(rows[1].contents.plans, 2);
  assert.deepEqual(setAside, []);
});

test("what's outside the trip's days is found, not dropped", () => {
  const plans = [plan(1), plan(0), plan(6), plan(5, 1380, 1500)];
  const { plans: out, days } = outsideTrip({ plans, dayPlaces: { 0: {}, 3: {}, 7: {} } }, 5);
  assert.deepEqual(out, [plans[1], plans[2]]);
  assert.deepEqual(days, [0, 7]);
  assert.deepEqual(outsideTrip({ plans, dayPlaces: {} }, null), { plans: [], days: [] });
});
