// Keeping the suite to its own data.
//
// Everything runs as one dedicated test account, and the only trips that
// account touches are ones it created itself, named with TRIP_PREFIX.
// Cleanup is DELETE /api/me (routers/account.py): for an account that only
// owns trips nobody else is on, that deletes exactly those trips and
// nothing else. The preview check below makes sure that's the situation
// before anything is deleted -- if the account has ended up on somebody
// else's trip, or owns one that isn't an E2E trip, the run stops instead.
import { ACCOUNT_EMAIL, API_URL, TRIP_PREFIX } from "./env.js";
import { ok, waitForBackend } from "./api.js";

export async function assertTestAccount(api) {
  const res = await waitForBackend(api);
  if (res.status() === 401) {
    throw new Error(
      `Not signed in at ${API_URL}: the test account's session is missing or has expired ` +
        "(Easy Auth sessions last 30 days). Run `npm run login` and update E2E_AUTH_STATE."
    );
  }
  const me = await ok(Promise.resolve(res), "GET /api/me");
  if (me.email.toLowerCase() !== ACCOUNT_EMAIL) {
    throw new Error(`Signed in as ${me.email}, not the test account ${ACCOUNT_EMAIL}. Refusing to run as anyone else.`);
  }
  return me;
}

export async function assertOnlyTestTrips(api) {
  const preview = await ok(api.get("/api/me/deletion-preview"), "GET /api/me/deletion-preview");
  const shared = [...preview.handed_over, ...preview.left];
  const notOurs = preview.deleted.filter((t) => !t.name.startsWith(TRIP_PREFIX));
  if (shared.length || notOurs.length) {
    const names = [...shared, ...notOurs].map((t) => `"${t.name}" (#${t.id})`).join(", ");
    throw new Error(
      `The test account ${ACCOUNT_EMAIL} is on trips the suite didn't make: ${names}. ` +
        "Cleanup would touch them, so nothing was deleted. Remove the account from those trips by hand."
    );
  }
  return preview.deleted;
}

// Delete every trip the test account has, after checking they're all E2E
// trips it owns alone.
export async function wipeTestTrips(api) {
  await assertTestAccount(api);
  const trips = await assertOnlyTestTrips(api);
  if (trips.length) await ok(api.delete("/api/me"), "DELETE /api/me");
  return trips.length;
}
