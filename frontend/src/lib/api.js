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

// --- Returning to the page someone was trying to open ----------------------
//
// Easy Auth only honours post_login_redirect_uri values that match
// login.allowedExternalRedirectUrls, which lists the bare frontend origin —
// a deep link like /join/abc or /trips/7/board isn't reliably accepted, and
// the provider chooser ("/?signin=1") drops the path altogether. So login
// always returns to the origin root, and the path the person actually
// wanted is kept here in sessionStorage (per tab, survives the round trip
// through the identity provider) and put back by restoreReturnPath() once
// the session check passes. A convenience only: if storage is blocked they
// land on Trips Home, same as before.
const RETURN_KEY = "vp.returnTo";
const RETURN_MAX_AGE_MS = 30 * 60 * 1000;

function rememberReturnPath() {
  const { pathname, search, hash } = window.location;
  if (isSignInLanding() || isSignedOutLanding()) return;
  if (pathname === "/" && !search && !hash) return;
  try {
    window.sessionStorage.setItem(
      RETURN_KEY,
      JSON.stringify({ path: pathname + search + hash, at: Date.now() })
    );
  } catch {
    // Not remembered; they'll land on Trips Home.
  }
}

export function clearReturnPath() {
  try {
    window.sessionStorage.removeItem(RETURN_KEY);
  } catch {
    // Nothing to clear.
  }
}

// Call after ensureSignedIn() resolves and before the router mounts, so
// BrowserRouter (and PlannerContext's read of :tripId) sees the restored
// URL as the initial location. Only ever a same-origin path.
export function restoreReturnPath() {
  let saved = null;
  try {
    saved = JSON.parse(window.sessionStorage.getItem(RETURN_KEY) || "null");
  } catch {
    saved = null;
  }
  clearReturnPath();
  if (!saved || typeof saved.path !== "string") return;
  if (Date.now() - (saved.at || 0) > RETURN_MAX_AGE_MS) return;
  if (!saved.path.startsWith("/") || saved.path.startsWith("//") || saved.path.startsWith("/\\")) return;
  // Only when we're sitting at the root login returned us to — a
  // direct visit to some other page shouldn't be overridden.
  const { pathname, search, hash } = window.location;
  if (pathname !== "/" || search || hash) return;
  window.history.replaceState(null, "", saved.path);
}

function redirectToLogin() {
  rememberReturnPath();
  const provider = automaticProvider();
  if (provider) {
    goToLogin(provider, window.location.origin + "/");
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
//
// With `accountDeleted` (pages/DeleteAccount.jsx, once DELETE /api/me has
// succeeded) this browser also forgets which provider it used and any
// page it meant to return to, and the signed-out screen says the account
// is gone rather than just signed out.
export const ACCOUNT_DELETED_PARAM = "deleted";

export function isAccountDeletedLanding() {
  return new window.URLSearchParams(window.location.search).has(ACCOUNT_DELETED_PARAM);
}

export function logout({ accountDeleted = false } = {}) {
  let returnTo = `${window.location.origin}/?${SIGNED_OUT_PARAM}=1`;
  if (accountDeleted) {
    try {
      window.localStorage.removeItem(PROVIDER_KEY);
    } catch {
      // Nothing to forget.
    }
    clearReturnPath();
    returnTo += `&${ACCOUNT_DELETED_PARAM}=1`;
  }
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
//
// The backend scales to zero when idle, and Easy Auth runs inside the same
// replica, so after a quiet spell this one request waits out a full cold
// start before it gets any answer at all -- including the 401 for a
// session that simply expired. Normally the platform just holds the
// request until the replica is up; if instead it gives up with a network
// error or a 502/503/504 while the replica is still starting, try again
// (backing off) for up to SESSION_CHECK_BUDGET_MS rather than falling
// straight through to "inconclusive" and rendering an app whose every
// API call is about to fail the same way. main.jsx shows BootScreen for
// the duration.
const SESSION_CHECK_BUDGET_MS = 120000;
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchSessionStatus() {
  const deadline = Date.now() + SESSION_CHECK_BUDGET_MS;
  for (let attempt = 0; ; attempt++) {
    let retryable;
    try {
      const res = await fetch(`${API_BASE}/api/me`, { credentials: "include" });
      if (res.ok) return true;
      if (res.status === 401) return false;
      retryable = RETRYABLE_STATUSES.has(res.status);
    } catch {
      // Network error, or a CORS failure (e.g. a platform error page
      // without the ingress's CORS headers) -- indistinguishable here.
      retryable = true;
    }
    const wait = Math.min(1000 * 2 ** attempt, 8000);
    if (!retryable || Date.now() + wait > deadline) return null;
    await sleep(wait);
  }
}

let sessionCheck = null;
function checkSession() {
  if (!sessionCheck) sessionCheck = fetchSessionStatus();
  return sessionCheck;
}

// For main.jsx's public homepage: at "/" a signed-out visitor is shown the
// homepage instead of being sent to log in, so it needs the answer rather
// than ensureSignedIn()'s redirect. Same cached check, same true / false /
// null meaning (null = inconclusive, treated as signed in).
export function isSignedIn() {
  return checkSession();
}

// Call once, as early as possible (see main.jsx), so a signed-out user is
// sent to log in (or to the provider chooser) before the app tries to
// render anything, rather than after its first API call fails. Resolves for everyone except a
// definitely-signed-out user, who never sees it resolve — the browser is
// already navigating to Easy Auth's login page instead.
//
// `onRedirect` runs just before the browser is sent to log in, so the
// caller can say so on screen (the identity provider's page can take a
// moment to appear).
export function ensureSignedIn({ onRedirect } = {}) {
  return checkSession().then((signedIn) => {
    if (signedIn === false) {
      onRedirect?.();
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
    // Read the body once. It used to be read here and then re-read through
    // res.clone() for err.body — but a body that has already been consumed
    // can't be cloned, so err.body was always null and every caller that
    // branches on a 409's detail (occupying_plan_id, contest_id, split_id…)
    // silently fell through to its generic error.
    const text = await res.text().catch(() => "");
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    const detail = data
      ? typeof data.detail === "string"
        ? data.detail
        : data.detail?.message || JSON.stringify(data.detail ?? data)
      : text;
    const err = new Error(`${method} ${path} → ${res.status}${detail ? `: ${detail}` : ""}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  me: () => request("/api/me"),
  // Your own account — see backend/app/routers/account.py.
  accountDeletionPreview: () => request("/api/me/deletion-preview"),
  deleteAccount: () => request("/api/me", { method: "DELETE" }),
  listTrips: () => request("/api/trips"),
  getTrip: (tripId) => request(`/api/trips/${tripId}`),
  createTrip: (payload) => request("/api/trips", { method: "POST", body: payload }),
  updateTrip: (tripId, fields) => request(`/api/trips/${tripId}`, { method: "PATCH", body: fields }),
  listContributors: (tripId) => request(`/api/trips/${tripId}/contributors`),

  // Sharing — see backend/app/routers/sharing.py. Roles are owner |
  // planner | companion | reader (lib/roles.js); what each may do is
  // backend/app/permissions.py.
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
  // `claim` says which listed traveler you are: { traveler_id } for one
  // already on the roster, { not_going: true } for a planner who isn't
  // travelling, or nothing to be added as yourself. A link made for one
  // traveler ignores it.
  acceptInvite: (token, claim) =>
    request(`/api/invites/${encodeURIComponent(token)}/accept`, { method: "POST", body: claim ?? {} }),

  // The traveler roster — who is going, separate from who's on the app
  // (backend/app/routers/travelers.py).
  listTravelers: (tripId) => request(`/api/trips/${tripId}/travelers`),
  createTraveler: (tripId, payload) => request(`/api/trips/${tripId}/travelers`, { method: "POST", body: payload }),
  patchTraveler: (travelerId, fields) => request(`/api/travelers/${travelerId}`, { method: "PATCH", body: fields }),
  deleteTraveler: (travelerId) => request(`/api/travelers/${travelerId}`, { method: "DELETE" }),
  // A link whoever accepts it signs in as this traveler.
  inviteTraveler: (travelerId, role) =>
    request(`/api/travelers/${travelerId}/invite`, { method: "POST", body: { role } }),

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
  // The group splitting up (backend/app/routers/splits.py). A split is
  // hours plus its groups; plans and proposals name a group by branch_id.
  // Reshaping sends the whole assignment of travelers to groups at once;
  // retiming changes only its hours (nothing changes hands); merging keeps one group's plans for everyone; joining moves only the
  // caller and returns the split, or null if that ended it.
  listSplits: (tripId) => request(`/api/trips/${tripId}/splits`),
  createSplit: (tripId, payload) => request(`/api/trips/${tripId}/splits`, { method: "POST", body: payload }),
  reshapeSplit: (splitId, branches) => request(`/api/splits/${splitId}`, { method: "PUT", body: { branches } }),
  retimeSplit: (splitId, startsAt, endsAt) =>
    request(`/api/splits/${splitId}/hours`, { method: "PUT", body: { starts_at: startsAt, ends_at: endsAt } }),
  mergeSplit: (splitId, keepBranchId) =>
    request(`/api/splits/${splitId}/merge`, { method: "POST", body: { keep_branch_id: keepBranchId } }),
  joinBranch: (branchId) => request(`/api/branches/${branchId}/join`, { method: "POST" }),

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
