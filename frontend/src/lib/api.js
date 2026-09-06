// Thin REST client for the FastAPI backend (backend/app/routers/*.py). Every
// function here maps 1:1 to one backend route — see that router file for
// the exact request/response shapes (backend/app/schemas.py is the
// contract). No caching, no retries: PlannerContext owns all client-side
// state and decides when to call these.

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");

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
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${path} → ${res.status}${text ? `: ${text}` : ""}`);
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
  toggleAvailabilityOverride: (pinId, day, band) =>
    request(`/api/pins/${pinId}/availability-overrides/toggle`, { method: "POST", body: { day, band } }),

  listBlocks: (tripId) => request(`/api/trips/${tripId}/blocks`),
  getBlock: (blockId) => request(`/api/blocks/${blockId}`),
  toggleVote: (blockId, candidateSetId) =>
    request(`/api/blocks/${blockId}/vote`, { method: "POST", body: { candidate_set_id: candidateSetId } }),
  lockBlock: (blockId, candidateSetId) =>
    request(`/api/blocks/${blockId}/lock`, { method: "POST", body: { candidate_set_id: candidateSetId } }),
  reopenBlock: (blockId) => request(`/api/blocks/${blockId}/reopen`, { method: "POST" }),

  listPinComments: (pinId) => request(`/api/pins/${pinId}/comments`),
  createComment: (tripId, payload) => request(`/api/trips/${tripId}/comments`, { method: "POST", body: payload }),
};
