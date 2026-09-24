import { newApi } from "./support/api.js";
import { wipeTestTrips } from "./support/account.js";

// E2E_KEEP_DATA=1 leaves the trips in place, to look at after a failure.
export default async function globalTeardown() {
  if (process.env.E2E_KEEP_DATA) return;
  const api = await newApi();
  try {
    await wipeTestTrips(api);
  } finally {
    await api.dispose();
  }
}
