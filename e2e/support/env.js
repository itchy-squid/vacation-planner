// Where the suite points, and who it's allowed to be. Everything comes from
// environment variables so the same tests run against the deployed dev
// site (CI, and `npm test` with the variables set) or a local stack.
//
//   E2E_BASE_URL       The frontend. Default http://localhost:5173 (Vite).
//   E2E_API_URL        The backend. Default: same as E2E_BASE_URL, which is
//                      right locally (Vite proxies /api) but not on Azure,
//                      where the API is its own host.
//   E2E_ACCOUNT_EMAIL  The test account's email. Required for a deployed
//                      site: the suite refuses to run as anybody else.
//   E2E_AUTH_STATE     The test account's Easy Auth session (see
//                      scripts/login.mjs). Not needed locally, where the
//                      backend signs everyone in as DEV_USER_EMAIL.
//   E2E_FORBIDDEN_HOSTS  Hosts the suite must never touch. Defaults to prod.

import { fileURLToPath } from "node:url";

const trimSlash = (url) => url.replace(/\/+$/, "");

export const BASE_URL = trimSlash(process.env.E2E_BASE_URL || "http://localhost:5173");
export const API_URL = trimSlash(process.env.E2E_API_URL || BASE_URL);

const isLocal = (url) => ["localhost", "127.0.0.1"].includes(new URL(url).hostname);
export const LOCAL = isLocal(BASE_URL) && isLocal(API_URL);

export const ACCOUNT_EMAIL = (process.env.E2E_ACCOUNT_EMAIL || (LOCAL ? "e2e@example.com" : "")).toLowerCase();

// Every trip the suite creates starts with this, and the only trips it will
// ever delete are ones that do (support/account.js).
export const TRIP_PREFIX = "E2E · ";
export const RUN_ID = process.env.E2E_RUN_ID || Date.now().toString(36);

// The session lives in this file between global setup and the tests.
export const STATE_FILE = fileURLToPath(new URL("../.auth/state.json", import.meta.url));
// What `npm run login` saves, so local runs don't need E2E_AUTH_STATE.
export const SESSION_FILE = fileURLToPath(new URL("../.auth/session.json", import.meta.url));

const FORBIDDEN_HOSTS = (process.env.E2E_FORBIDDEN_HOSTS ?? "vacations.amandasanti.com,vacations-api.amandasanti.com")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

export function assertAllowedTarget() {
  for (const url of [BASE_URL, API_URL]) {
    const host = new URL(url).hostname.toLowerCase();
    if (FORBIDDEN_HOSTS.includes(host)) {
      throw new Error(`Refusing to run end-to-end tests against ${host}: that's production. Point E2E_BASE_URL/E2E_API_URL at dev.`);
    }
  }
  if (!ACCOUNT_EMAIL) {
    throw new Error("Set E2E_ACCOUNT_EMAIL to the test account's email. The suite only runs as that account.");
  }
}
