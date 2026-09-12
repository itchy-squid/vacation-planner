// Thin REST client for the FastAPI backend (backend/app/routers/*.py). Every
// function here maps 1:1 to one backend route — see that router file for
// the exact request/response shapes (backend/app/schemas.py is the
// contract). No caching, no retries: PlannerContext owns all client-side
// state and decides when to call these.

// Empty by default: local dev goes through the Vite dev server's proxy
// (frontend/vite.config.js) instead of calling the backend cross-origin,
// so requests are same-origin and relative. CI sets VITE_API_BASE_URL to
// the real backend URL for deployed environments (see
// .github/workflows/deploy.yml).
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

async function request(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(`Could not reach the API at ${API_BASE} (${method} ${path}). Is the backend running? — ${err.message}`);
  }
  if (!res.ok) {
    let detail = "";
    try {
      const data = await res.json();
      detail = typeof data.detail === "string" ? data.detail : data.detail?.message || JSON.stringify(data.detail ?? data);
    } catch {
      detail = await res.text().catch(() => "");
    }
    const err = new Error(`${method} ${path} → ${res.status}${detail ? `: ${detail}` : ""}`);
    err.status = res.status;
    try {
      err.body = await res.clone().json();
    } catch {
      err.body = null;
    }
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  listTrips: () => request("/api/trips"),
  getTrip: (tripId) => request(`/api/trips/${tripId}`),
  createTrip: (payload) => request("/api/trips", { method: "POST", body: payload }),
  updateTrip: (tripId, fields) => request(`/api/trips/${tripId}`, { method: "PATCH", body: fields }),
  listContributors: (tripId) => request(`/api/trips/${tripId}/contributors`),

  listPins: (tripId) => request(`/api/trips/${tripId}/pins`),
  createPin: (tripId, payload) => request(`/api/trips/${tripId}/pins`, { method: "POST", body: payload }),
  getPin: (pinId) => request(`/api/pins/${pinId}`),
  patchPin: (pinId, fields) => request(`/api/pins/${pinId}`, { method: "PATCH", body: fields }),
  deletePin: (pinId) => request(`/api/pins/${pinId}`, { method: "DELETE" }),
  toggleAvailabilityOverride: (pinId, day, band) =>
    request(`/api/pins/${pinId}/availability-overrides/toggle`, { method: "POST", body: { day, band } }),

  // Scheduling — see docs/features/scheduling-feature-spec.md "API".
  listPlans: (tripId) => request(`/api/trips/${tripId}/plans`),
  createPlan: (tripId, payload) => request(`/api/trips/${tripId}/plans`, { method: "POST", body: payload }),
  movePlan: (planId, fields) => request(`/api/plans/${planId}`, { method: "PATCH", body: fields }),
  deletePlan: (planId) => request(`/api/plans/${planId}`, { method: "DELETE" }),

  proposeAlternative: (tripId, payload) => request(`/api/trips/${tripId}/contests`, { method: "POST", body: payload }),
  getContest: (contestId) => request(`/api/contests/${contestId}`),
  toggleContestVote: (contestId, planId) =>
    request(`/api/contests/${contestId}/vote`, { method: "POST", body: { plan_id: planId } }),
  lockContest: (contestId, planId) =>
    request(`/api/contests/${contestId}/lock`, { method: "POST", body: { plan_id: planId } }),
  reopenPlan: (planId) => request(`/api/plans/${planId}/reopen`, { method: "POST" }),

  listTravelItems: (tripId) => request(`/api/trips/${tripId}/travel-items`),
  createTravelItem: (tripId, payload) => request(`/api/trips/${tripId}/travel-items`, { method: "POST", body: payload }),
  patchTravelItem: (id, fields) => request(`/api/travel-items/${id}`, { method: "PATCH", body: fields }),
  deleteTravelItem: (id) => request(`/api/travel-items/${id}`, { method: "DELETE" }),

  listPinComments: (pinId) => request(`/api/pins/${pinId}/comments`),
  createComment: (tripId, payload) => request(`/api/trips/${tripId}/comments`, { method: "POST", body: payload }),
};
