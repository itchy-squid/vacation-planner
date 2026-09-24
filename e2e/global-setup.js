import { assertAllowedTarget, BASE_URL, API_URL } from "./support/env.js";
import { writeStorageState } from "./support/session.js";
import { newApi } from "./support/api.js";
import { assertTestAccount, wipeTestTrips } from "./support/account.js";

export default async function globalSetup() {
  assertAllowedTarget();
  writeStorageState();
  const api = await newApi();
  try {
    const me = await assertTestAccount(api);
    // Anything a crashed earlier run left behind.
    const swept = await wipeTestTrips(api);
    console.log(`E2E: ${BASE_URL} (API ${API_URL}) as ${me.email}${swept ? `; cleared ${swept} leftover trip(s)` : ""}`);
  } finally {
    await api.dispose();
  }
}
