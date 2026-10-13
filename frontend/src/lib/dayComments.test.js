import { test } from "node:test";
import assert from "node:assert/strict";
import { commentsByDay, normalizeDayComment } from "./dayComments.js";

const raw = (id, day, created) => ({ id, day, body: `c${id}`, contributor_id: 7, created_at: created, edited_at: null, pin_id: null, plan_id: null });

test("a comment from the API keeps its day, author and times", () => {
  assert.deepEqual(normalizeDayComment(raw(1, 3, "2026-10-13T10:00:00Z")), {
    id: 1,
    day: 3,
    body: "c1",
    who: 7,
    createdAt: "2026-10-13T10:00:00Z",
    editedAt: null,
  });
});

test("comments group by day, oldest first, and empty days have no entry", () => {
  const list = [raw(3, 2, "2026-10-13T12:00:00Z"), raw(1, 4, "2026-10-13T09:00:00Z"), raw(2, 2, "2026-10-13T11:00:00Z")].map(normalizeDayComment);
  const byDay = commentsByDay(list);
  assert.deepEqual(Object.keys(byDay), ["2", "4"]);
  assert.deepEqual(byDay[2].map((c) => c.id), [2, 3]);
});

test("comments posted in the same instant keep the order they were made", () => {
  const list = [raw(5, 1, "2026-10-13T12:00:00Z"), raw(4, 1, "2026-10-13T12:00:00Z")].map(normalizeDayComment);
  assert.deepEqual(commentsByDay(list)[1].map((c) => c.id), [4, 5]);
});
