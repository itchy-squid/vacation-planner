// Sign the test account in by hand, once, and save its session.
//
//   npm run login
//
// Opens a real browser at E2E_BASE_URL. Sign in there as the test account
// (E2E_ACCOUNT_EMAIL) -- never your own. When the app is signed in, the
// Easy Auth session cookies are written to .auth/session.json, which
// local runs pick up automatically. For CI, store that file's contents as
// the dev environment's E2E_AUTH_STATE secret:
//
//   gh secret set E2E_AUTH_STATE --env dev < .auth/session.json
//
// The session lasts 30 days from sign-in (sessionLifetime in
// infra/modules/container-app-backend.bicep); run this again when the
// suite says it has expired.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { ACCOUNT_EMAIL, API_URL, BASE_URL, LOCAL, SESSION_FILE, assertAllowedTarget } from "../support/env.js";
import { SESSION_COOKIE, encodeSession } from "../support/session.js";

assertAllowedTarget();
if (LOCAL) {
  console.log("Local backends sign everyone in as DEV_USER_EMAIL; there's nothing to log in to.");
  process.exit(0);
}

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();
console.log(`Sign in at ${BASE_URL} as ${ACCOUNT_EMAIL} in the browser window. Waiting up to 5 minutes...`);
await page.goto(BASE_URL);

const deadline = Date.now() + 5 * 60_000;
let me = null;
while (!me && Date.now() < deadline) {
  const res = await context.request.get(`${API_URL}/api/me`, { failOnStatusCode: false }).catch(() => null);
  if (res?.ok()) me = await res.json();
  else await page.waitForTimeout(2000);
}
if (!me) {
  await browser.close();
  throw new Error("Timed out waiting for sign-in.");
}
if (me.email.toLowerCase() !== ACCOUNT_EMAIL) {
  await browser.close();
  throw new Error(`Signed in as ${me.email}, not ${ACCOUNT_EMAIL}. Nothing was saved -- sign out and use the test account.`);
}

const cookies = (await context.cookies(API_URL)).filter((c) => SESSION_COOKIE.test(c.name));
await browser.close();
if (!cookies.length) throw new Error(`Signed in, but found no AppServiceAuthSession cookie on ${new URL(API_URL).host}.`);

fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
fs.writeFileSync(SESSION_FILE, encodeSession(cookies), { mode: 0o600 });
console.log(`Saved ${me.email}'s session to ${path.relative(process.cwd(), SESSION_FILE)}.`);
console.log("For CI:  gh secret set E2E_AUTH_STATE --env dev < .auth/session.json");
