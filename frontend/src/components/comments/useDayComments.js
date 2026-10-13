import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { commentsByDay, normalizeDayComment } from "../../lib/dayComments";

// The trip's comments on its days, loaded when a screen that shows them
// opens (the Plan tab, the Itinerary) and kept here rather than in
// PlannerContext: nothing else on the trip depends on them. Another
// person's new comment shows on the next visit, like every other change
// until something listens to the trip's events.
export function useDayComments(tripId) {
  const [comments, setComments] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (tripId == null) return undefined;
    let live = true;
    setLoaded(false);
    api
      .listDayComments(tripId)
      .then((rows) => {
        if (!live) return;
        setComments(rows.map(normalizeDayComment));
        setLoaded(true);
      })
      // Comments are extra: a failed load leaves the day without them
      // rather than taking the screen down.
      .catch(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [tripId]);

  const byDay = useMemo(() => commentsByDay(comments), [comments]);

  const add = useCallback(
    async (day, body) => {
      const saved = normalizeDayComment(await api.createComment(tripId, { day, body }));
      setComments((list) => [...list, saved]);
      return saved;
    },
    [tripId]
  );

  const edit = useCallback(
    async (id, body) => {
      const saved = normalizeDayComment(await api.updateComment(tripId, id, body));
      setComments((list) => list.map((c) => (c.id === id ? saved : c)));
    },
    [tripId]
  );

  const remove = useCallback(
    async (id) => {
      await api.deleteComment(tripId, id);
      setComments((list) => list.filter((c) => c.id !== id));
    },
    [tripId]
  );

  return { byDay, loaded, add, edit, remove };
}
