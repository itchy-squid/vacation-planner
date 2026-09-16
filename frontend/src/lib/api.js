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
// own hosted login lives at `${API_BASE}/.auth/login/<provider>` (`aad` for
// Microsoft, `google` for Google), and a signed-in
// session is just a cookie the browser holds for the API's origin. This
// layer's whole job is: (1) send that cookie cross-origin, (2) notice when
// there isn't one, and (3) send the browser to log in and back.
//
// The "is there a session" check goes to the backend's own GET /api/me
// (backend/app/routers/me.py), NOT Easy Auth's /.auth/me: Container Apps
// only serves /.auth/me when Easy Auth's token store is enabled, which
// there means a storage account plus a SAS URL kept as a Container App
// secret — so /.auth/me 404s on this deployment even for a valid session.
// /api/me reads the same X-MS-CLIENT-PRINCIPAL headers, which the platform
// forwards with no token store at all.
//
// Locally /api/me answers over the Vite proxy with DEV_USER_EMAIL, so
// local dev reads as signed in rather than as an inconclusive check. Every
// other failure still fails soft: only a definite 401 counts as "signed
// out", so a network hiccup or a CORS problem never locks anyone out of
// the app.

// Which Easy Auth providers this deployment has turned on, baked in at build
// time by .github/workflows/deploy.yml from the same variables the infra job
// uses (EASY_AUTH_CLIENT_ID -> "aad", EASY_AUTH_GOOGLE_CLIENT_ID ->
// "google"). Unset means Microsoft only, which is what every build did
// before Google existed.
export const PROVIDER_LABELS = { aad: "Microsoft", google: "Google" };
export const AUTH_PROVIDERS = (import.meta.env.VITE_AUTH_PROVIDERS ?? "aad")
  .split(",")
  .map((p) => p.trim())
  .filter((p) => p in PROVIDER_LABELS);

// The provider this browser last signed in with, so an expired session can
// go straight back to it instead of stopping at the chooser. A convenience
// only: storage can be missing or blocked, and then we just ask again.
const PROVIDER_KEY = "vp.authProvider";

function rememberedProvider() {
  try {
    const p = window.localStorage.getItem(PROVIDER_KEY);
    return AUTH_PROVIDERS.includes(p) ? p : null;
  } catch {
    return null;
  }
}

// The provider to send someone to without asking, or null if they have to
// pick (more than one provider, and none remembered).
function automaticProvider() {
  if (AUTH_PROVIDERS.length === 1) return AUTH_PROVIDERS[0];
  return rememberedProvider();
}

function loginUrl(provider, returnTo) {
  return `${API_BASE}/.auth/login/${provider}?post_login_redirect_uri=${encodeURIComponent(returnTo)}`;
}

function goToLogin(provider, returnTo) {
  try {
    window.localStorage.setItem(PROVIDER_KEY, provider);
  } catch {
    // Not remembered; the chooser will ask next time.
  }
  window.location.href = loginUrl(provider, returnTo);
}

// Query-string marker for the "choose how to sign in" screen (main.jsx),
// used when there's no session and no provider we can pick on our own.
export const SIGN_IN_PARAM = "signin";

export function isSignInLanding() {
  return new window.URLSearchParams(window.location.search).has(SIGN_IN_PARAM);
}

function redirectToLogin() {
  const provider = automaticProvider();
  if (provider) {
    goToLogin(provider, window.location.href);
  } else {
    window.location.href = `${window.location.origin}/?${SIGN_IN_PARAM}=1`;
  }
}

// Query-string marker appended to the post-logout URL below and read by
// main.jsx. Without it a signed-out user lands back on the frontend root,
// ensureSignedIn() finds no session, and they're bounced straight back
// into Entra — logging out would look like it did nothing.
export const SIGNED_OUT_PARAM = "signedout";

export function isSignedOutLanding() {
  return new window.URLSearchParams(window.location.search).has(SIGNED_OUT_PARAM);
}

// Easy Auth's logout endpoint clears its own session cookie, then honours
// post_logout_redirect_uri under the same allowlist rule as login's
// post_login_redirect_uri (infra/modules/container-app-backend.bicep's
// authConfig → login.allowedExternalRedirectUrls, which lists the
// frontend origin). Note this signs the user out of *this app* only; it
// deliberately doesn't hit Entra's own /oauth2/logout, which would sign
// them out of their Microsoft account everywhere.
export function logout() {
  const returnTo = `${window.location.origin}/?${SIGNED_OUT_PARAM}=1`;
  window.location.href = `${API_BASE}/.auth/logout?post_logout_redirect_uri=${encodeURIComponent(returnTo)}`;
}

// The Sign in buttons on the signed-out / sign-in screens (see main.jsx).
// Same hosted Easy Auth login as the automatic redirect, just
// user-initiated, and always returning to the app root.
export function signIn(provider) {
  goToLogin(provider, window.location.origin + "/");
}

// Resolved once per page load: true if the API reports a signed-in user,
// false if it positively reports signed-out (401 — either from Easy Auth's
// ingress, which rejects anonymous requests before they reach FastAPI, or
// from /api/me itself), null if the check was inconclusive (the API
// unreachable, a CORS failure, a 5xx). Callers treat null the same as
// "don't block" — see ensureSignedIn.
let sessionCheck = null;
function checkSession() {
  if (!sessionCheck) {
    sessionCheck = fetch(`${API_BASE}/api/me`, { credentials: "include" })
      .then((res) => {
        if (res.ok) return true;
        if (res.status === 401) return false;
        return null;
      })
      .catch(() => null);
  }
  return sessionCheck;
}

// Call once, as early as possible (see main.jsx), so a signed-out user is
// sent to log in (or to the provider chooser) before the app tries to
// render anything, rather than after its first API call fails. Resolves for everyone except a
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
  me: () => request("/api/me"),
  listTrips: () => request("/api/trips"),
  getTrip: (tripId) => request(`/api/trips/${tripId}`),
  createTrip: (payload) => request("/api/trips", { method: "POST", body: payload }),
  updateTrip: (tripId, fields) => request(`/api/trips/${tripId}`, { method: "PATCH", body: fields }),
  listContributors: (tripId) => request(`/api/trips/${tripId}/contributors`),

  // Sharing — see backend/app/routers/sharing.py. Roles are owner |
  // contributor | reader; what each may do is backend/app/permissions.py.
  changeRole: (tripId, contributorId, role) =>
    request(`/api/trips/${tripId}/contributors/${contributorId}`, { method: "PATCH", body: { role } }),
  removeContributor: (tripId, contributorId) =>
    request(`/api/trips/${tripId}/contributors/${contributorId}`, { method: "DELETE" }),
  leaveTrip: (tripId) => request(`/api/trips/${tripId}/leave`, { method: "POST" }),
  listInvites: (tripId) => request(`/api/trips/${tripId}/invites`),
  // Returns the live link for `role`, creating it on first ask.
  getInvite: (tripId, role) => request(`/api/trips/${tripId}/invites`, { method: "POST", body: { role } }),
  revokeInvite: (tripId, inviteId) => request(`/api/trips/${tripId}/invites/${inviteId}`, { method: "DELETE" }),
  previewInvite: (token) => request(`/api/invites/${encodeURIComponent(token)}`),
  acceptInvite: (token) => request(`/api/invites/${encodeURIComponent(token)}/accept`, { method: "POST" }),

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
  lockPlan: (planId) => request(`/api/plans/${planId}/lock`, { method: "POST" }),

  // Propose a block: { starts_at, ends_at, label?, rationale?, items:
  // [{ pin_id | travel_item_id, duration_minutes? }] }. There's no
  // against_plan_id any more — a proposal claims a range of hours, and the
  // server captures whatever is already in them into one "on the board"
  // option (see backend/app/routers/contests.py::open_block_contest).
  proposeBlock: (tripId, payload) => request(`/api/trips/${tripId}/contests`, { method: "POST", body: payload }),
  // Turns the caller's own draft block into a real proposal. 409s if the
  // hours went out for a vote while the draft sat unpublished.
  publishPlan: (planId) => request(`/api/plans/${planId}/publish`, { method: "POST" }),
  getContest: (contestId) => request(`/api/contests/${contestId}`),
  // Rewrite one candidate plan — its stops, their times, its name and its
  // case: { label, rationale, items: [...] }, the same item shape
  // proposeBlock takes, minus the window (an option always spans its
  // contest's hours). Returns the whole contest, because saving clears the
  // votes cast for that plan and the tally on screen has to change with it
  // (see backend/app/routers/contests.py::update_proposal).
  updateProposal: (planId, payload) => request(`/api/plans/${planId}/stops`, { method: "PUT", body: payload }),

  toggleContestVote: (contestId, planId) =>
    request(`/api/contests/${contestId}/vote`, { method: "POST", body: { plan_id: planId } }),
  // Settles a decision: the chosen set's stops go onto the calendar as
  // separate placed plans, and the contest is deleted. Returns
  // { placed_plans }.
  pickSet: (contestId, planId) =>
    request(`/api/contests/${contestId}/pick`, { method: "POST", body: { plan_id: planId } }),
  reopenPlan: (planId) => request(`/api/plans/${planId}/reopen`, { method: "POST" }),

  listTravelItems: (tripId) => request(`/api/trips/${tripId}/travel-items`),
  createTravelItem: (tripId, payload) => request(`/api/trips/${tripId}/travel-items`, { method: "POST", body: payload }),
  patchTravelItem: (id, fields) => request(`/api/travel-items/${id}`, { method: "PATCH", body: fields }),
  deleteTravelItem: (id) => request(`/api/travel-items/${id}`, { method: "DELETE" }),

  listPinComments: (pinId) => request(`/api/pins/${pinId}/comments`),
  createComment: (tripId, payload) => request(`/api/trips/${tripId}/comments`, { method: "POST", body: payload }),
};
