// The test account's Easy Auth session, as Playwright storage state.
//
// Easy Auth keeps a signed-in session in cookies on the API's own host,
// named AppServiceAuthSession (split into AppServiceAuthSession1, 2, ...
// when the claims don't fit in one cookie). There's no token store on this
// deployment, so those cookies ARE the session: copying them is all it
// takes to be signed in. scripts/login.mjs captures them once, by hand;
// E2E_AUTH_STATE carries them into CI as base64 JSON.
import fs from "node:fs";
import path from "node:path";
import { API_URL, LOCAL, SESSION_FILE, STATE_FILE } from "./env.js";

export const SESSION_COOKIE = /^AppServiceAuthSession\d*$/;

export function encodeSession(cookies) {
  const kept = cookies.filter((c) => SESSION_COOKIE.test(c.name)).map(({ name, value, expires }) => ({ name, value, expires }));
  return Buffer.from(JSON.stringify(kept)).toString("base64");
}

function decodeSession(encoded) {
  try {
    const cookies = JSON.parse(Buffer.from(encoded.trim(), "base64").toString("utf8"));
    if (Array.isArray(cookies) && cookies.every((c) => SESSION_COOKIE.test(c.name) && c.value)) return cookies;
  } catch {
    // fall through
  }
  throw new Error("E2E_AUTH_STATE isn't a session saved by `npm run login` (base64 JSON of AppServiceAuthSession cookies).");
}

function savedSession() {
  if (process.env.E2E_AUTH_STATE) return decodeSession(process.env.E2E_AUTH_STATE);
  if (fs.existsSync(SESSION_FILE)) return decodeSession(fs.readFileSync(SESSION_FILE, "utf8"));
  return null;
}

// Writes STATE_FILE for the browser and API contexts. Locally there may be
// no session at all (the dev backend signs in as DEV_USER_EMAIL); against
// a deployed site that's an error the caller reports.
export function writeStorageState() {
  const cookies = savedSession();
  if (!cookies && !LOCAL) {
    throw new Error("No test-account session. Run `npm run login` (saves .auth/session.json), or set E2E_AUTH_STATE.");
  }
  const domain = new URL(API_URL).hostname;
  const state = {
    cookies: (cookies ?? []).map((c) => ({
      name: c.name,
      value: c.value,
      domain,
      path: "/",
      expires: c.expires ?? -1,
      httpOnly: true,
      secure: API_URL.startsWith("https:"),
      // The SPA calls the API cross-site with credentials, so the cookie
      // has to be sendable cross-site.
      sameSite: API_URL.startsWith("https:") ? "None" : "Lax",
    })),
    origins: [],
  };
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  return state;
}
