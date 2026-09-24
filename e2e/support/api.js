// A signed-in API client for seeding and checking data, sharing the
// browser's session (support/session.js).
import { request } from "@playwright/test";
import { API_URL, STATE_FILE } from "./env.js";

export async function newApi() {
  return request.newContext({ baseURL: API_URL, storageState: STATE_FILE });
}

// Dev scales to zero when idle, so the first request of a run can meet a
// cold start: the platform answers 502/503/504 until the replica is up.
// Retry those, and only those, for a couple of minutes.
export async function waitForBackend(api, { timeoutMs = 180_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    try {
      last = await api.get("/api/me");
      if (![502, 503, 504].includes(last.status())) return last;
    } catch (err) {
      last = err;
    }
    if (Date.now() > deadline) {
      throw new Error(`Backend at ${API_URL} still isn't answering after ${timeoutMs / 1000}s: ${last?.status?.() ?? last}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

// JSON from a request that has to succeed, with the response body in the
// error when it doesn't -- a 409's message is usually the whole story.
export async function ok(responsePromise, what) {
  const res = await responsePromise;
  if (!res.ok()) {
    throw new Error(`${what} failed: ${res.status()} ${await res.text()}`);
  }
  return res.status() === 204 ? null : res.json();
}
