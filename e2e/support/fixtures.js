// `test` for every spec: `api` is a signed-in API client, `seed` makes a
// trip for this test alone (support/seed.js). Trips are deleted at the end
// of the run by global-teardown.js, not per test, so a failed test's data
// is still there with E2E_KEEP_DATA=1.
import { test as base, expect } from "@playwright/test";
import { newApi } from "./api.js";
import { seedTrip } from "./seed.js";

export const test = base.extend({
  api: async ({}, use) => {
    const api = await newApi();
    await use(api);
    await api.dispose();
  },
  seed: async ({ api }, use, testInfo) => {
    await use((options = {}) => seedTrip(api, { title: testInfo.title, ...options }));
  },
});

export { expect };
