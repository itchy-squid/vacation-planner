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

// --- Easy Auth session handling -------------------------------------------
//
// In production the backend sits behind Azure Container Apps' built-in auth
// ("Easy Auth" — see backend/app/auth.py and
// infra/modules/container-app-backend.bicep's authConfig). Anonymous
// requests get a 401 from the platform itself, before the request ever
// reaches FastAPI, so there's no sign-in *form* to build here — Easy Auth's
// own hosted login lives at `${API_BASE}/.auth/login/aad`, and a signed-in
// session is just a cookie the browser holds for the API's origin. This
// layer's whole job is: (1) send that cookie cross-origin, (2) notice when
// there isn't one, and (3) send the browser to log in and back.
//
// Locally there's no Easy Auth at all — `/.auth/me` doesn't exist (the Vite
// proxy only forwards /api and /healthz, see vite.config.js) — so every
// check below fails soft: anything other than a definite "signed out"
// answer is treated as "carry on", which is what keeps local dev working
// unauthenticated exactly as it did before this layer existed.

function loginUrl() {
  const returnTo = window.location.href;
  return `${API_BASE}/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(returnTo)}`;
}

function redirectToLogin() {
  window.location.href = loginUrl();
}

// Resolved once per page load: true if Easy Auth reports a signed-in user,
// false if it positively reports signed-out, null if the check itself was
// inconclusive (local dev, a network hiccup, no Easy Auth in front of us at
// all). Callers treat null the same as "don't block" — see ensureSignedIn.
let sessionCheck = null;
function checkSession() {
  if (!sessionCheck) {
    sessionCheck = fetch(`${API_BASE}/.auth/me`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((claims) => (Array.isArray(claims) ? claims.length > 0 : null))
      .catch(() => null);
  }
  return sessionCheck;
}

// Call once, as early as possible (see main.jsx), so a signed-out user is
// sent to log in before the app tries to render anything, rather than
// after its first API call fails. Resolves for everyone except a
// definitely-signed-out user, who never sees it resolve — the browser is
// already navigating to Easy Auth's login page instead.
export function ensureSignedIn() {
  return checkSession().then((signedIn) => {
    if (signedIn === false) {
      redirectToLogin();
      return new Promise(() => {}); // navigating away — never resolves
    }
  });
}

async function request(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: "include",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(`Could not reach the API at ${API_BASE} (${method} ${path}). Is the backend running? — ${err.message}`);
  }
  if (res.status === 401) {
    // Easy Auth's own signal for "not authenticated" (see backend/app/auth.py
    // — the app itself only ever raises 401 for that same reason, never for
    // "signed in but not allowed", which is 403). A session that expired
    // mid-visit ends up here too, not just the first anonymous load.
    redirectToLogin();
    return new Promise(() => {}); // navigating away — never resolves
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
