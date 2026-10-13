// Comments on a day of the trip (backend/app/routers/comments.py): on the
// whole day, by day of the trip (1 is the first), oldest first.

/** A comment from the API, in the shape the screens use. */
export function normalizeDayComment(c) {
  return { id: c.id, day: c.day, body: c.body, who: c.contributor_id, createdAt: c.created_at, editedAt: c.edited_at ?? null };
}

/** { [day]: [comment, ...] }, each day oldest first. Days with none have no entry. */
export function commentsByDay(comments) {
  const byDay = {};
  for (const c of comments) (byDay[c.day] ??= []).push(c);
  for (const list of Object.values(byDay)) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
  return byDay;
}
