-- Run once against the `vacation_planner` database, connected as the
-- Microsoft Entra Administrator (the identity designated by the aadAdmin
-- resource in infra/modules/postgres.bicep — e.g. via
--   psql "host=<fqdn> dbname=vacation_planner user=<your-upn> sslmode=require"
-- with a Microsoft Entra access token as the password; see
-- infra/README.md "Managed identity database auth" for the exact connect
-- command). Run this BEFORE the first `alembic upgrade head`.
--
-- Design (see the two Simple Talk articles this is based on — linked from
-- infra/README.md):
--   - ONE group role, db_owner, owns every table. Individual people never
--     own anything directly — that's what makes "add a maintainer" a
--     single GRANT rather than a table-by-table ALTER ... OWNER TO (and
--     once a table has real data, changing who owns it isn't something
--     you want to be doing routinely anyway).
--   - Maintainers (you, plus anyone you add later) get membership in
--     db_owner WITH ADMIN OPTION, so any current maintainer can add the
--     next one without you personally being involved.
--   - The app's own connection (its managed identity) only ever gets
--     db_rw — read/write, no DDL, no ownership. It cannot alter its own
--     schema or escalate itself into db_owner. See the very bottom of
--     this file for the "prove it" queries.
--   - ALTER DEFAULT PRIVILEGES is set for the db_owner role *before* any
--     tables exist, so every table the first migration (or any later one)
--     creates automatically grants db_rw the right privileges — no
--     per-table re-granting, ever, as long as migrations run with
--     `SET ROLE db_owner` active. backend/alembic/env.py does this
--     automatically whenever it finds db_owner already exists, which is
--     exactly the case once this script has run.

-- ============================================================================
-- 1. Map the two AAD principals this deployment already knows about to
--    Postgres roles. Both functions are callable only by an azure_pg_admin
--    member (i.e. by whoever is connected as the Entra Administrator right
--    now, running this script).
-- ============================================================================

-- Your own login. (Prefer the "AAD group" alternative near the bottom of
-- this file if you'd rather not touch SQL again the next time someone
-- joins as a maintainer.)
SELECT pgaadauth_create_principal_with_oid(
  'maintainers',                    -- Postgres role name
  '<MAINTAINERS_AAD_OBJECT_ID>',    -- your own Microsoft Entra object ID
  'user',                           -- 'user' | 'group' | 'service'
  false,                            -- isAdmin — false: a normal role, not another azure_pg_admin
  false                             -- isMfa
);

-- The backend Container App's user-assigned managed identity — its object
-- ID is the `backendIdentityObjectId` output from the main.bicep
-- deployment (`az deployment group show ... --query properties.outputs`,
-- or read straight off the deploy command's own terminal output).
SELECT pgaadauth_create_principal_with_oid(
  'app-backend',
  '<BACKEND_IDENTITY_AAD_OBJECT_ID>',
  'service',
  false,
  false
);

-- ============================================================================
-- 2. The two group roles that actually hold privileges. Neither can log in
--    directly — they're containers, not accounts.
-- ============================================================================
CREATE ROLE db_owner NOLOGIN;
CREATE ROLE db_rw NOLOGIN;

-- Maintainers get full ownership-equivalent privileges, AND the ability to
-- grant that same membership to someone else later — that's the WITH
-- ADMIN OPTION (see "Adding a maintainer later" below).
GRANT db_owner TO maintainers WITH ADMIN OPTION;

-- The app gets read/write only.
GRANT db_rw TO "app-backend";

-- ============================================================================
-- 3. Lock down PUBLIC. Postgres grants some privileges to everyone by
--    default (e.g. CREATE on the public schema) — undo that so access is
--    exactly what's granted above, nothing implicit.
-- ============================================================================
REVOKE ALL ON DATABASE vacation_planner FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

GRANT CONNECT, TEMPORARY ON DATABASE vacation_planner TO db_owner, db_rw;
GRANT USAGE, CREATE ON SCHEMA public TO db_owner;
GRANT USAGE ON SCHEMA public TO db_rw;

-- ============================================================================
-- 4. Default privileges for tables/sequences db_owner creates FROM NOW
--    ON. This is what makes the very first `alembic upgrade head` (and
--    every migration after it) automatically hand db_rw the right
--    privileges on each new table — no follow-up grant, ever.
-- ============================================================================
ALTER DEFAULT PRIVILEGES FOR ROLE db_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO db_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE db_owner IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO db_rw;

-- ============================================================================
-- 5. Catch-up grants for any tables that already exist when this script
--    runs. Harmless no-op against a brand-new, empty database (the normal
--    case — this is meant to run before the first migration); matters
--    only if you're retrofitting this onto a database that already has
--    the app schema from before AAD auth was turned on.
-- ============================================================================
GRANT ALL ON ALL TABLES IN SCHEMA public TO db_owner;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO db_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO db_rw;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO db_rw;

-- Done. Now run `alembic upgrade head` (see infra/README.md) — every table
-- it creates will be owned by db_owner and instantly readable/writable by
-- db_rw, thanks to the default privileges above.


-- ============================================================================
-- Adding a maintainer later
-- ============================================================================
-- Any existing maintainer (anyone already granted db_owner above) can add
-- the next one themselves — no Azure/Entra admin access, no superuser, no
-- waiting on whoever ran this script originally — EXCEPT for one line:
-- pgaadauth_create_principal_with_oid is only callable by an azure_pg_admin
-- member (the Entra Administrator). So mapping a *brand-new* person's AAD
-- identity to a Postgres role still needs that admin; granting them
-- db_owner once that's done does not.
--
--   -- (admin only) map their AAD identity to a new Postgres role:
--   SELECT pgaadauth_create_principal_with_oid(
--     '<a name for their role, e.g. their first name>',
--     '<their Microsoft Entra object ID>',
--     'user', false, false
--   );
--   -- (any current maintainer can run this part):
--   GRANT db_owner TO "<same role name>" WITH ADMIN OPTION;
--
-- Removing a maintainer: `REVOKE db_owner FROM "<their role name>";` (any
-- current maintainer can run this). That alone leaves their login still
-- able to connect with no privileges — pair it with
-- `DROP ROLE "<their role name>";` if they should lose database access
-- entirely, not just table ownership.


-- ============================================================================
-- Alternative: map an Entra security group instead of individual people
-- ============================================================================
-- The setup above maps each maintainer's own Entra identity to their own
-- Postgres role, which still needs the admin-only line above for each new
-- person. If you'd rather add/remove maintainers purely in Azure — with NO
-- SQL at all, ever again — create an Entra security group once (e.g.
-- "vacation-planner-maintainers"), add people to it in the Azure portal or
-- via `az ad group member add`, and map the GROUP itself instead of your
-- own individual login in step 1 above:
--
--   SELECT pgaadauth_create_principal_with_oid(
--     'maintainers', '<GROUP_AAD_OBJECT_ID>', 'group', false, false
--   );
--   GRANT db_owner TO maintainers;
--
-- Every member of that group can then connect using Postgres username
-- "maintainers" with their own individual Entra credentials — Azure
-- validates group membership from their token, so adding or removing
-- someone is purely an Entra group-membership change from then on. The
-- tradeoff: Postgres's own connection log shows everyone as "maintainers"
-- rather than as themselves. This app's own "who did what" tracking lives
-- at the application layer instead (see backend/app/models.py
-- Contributor.email, populated from Easy Auth — unrelated to, and
-- unaffected by, whichever Postgres username ran the query), so this
-- tradeoff is a fine default for a small collaborative app like this one.


-- ============================================================================
-- Sanity checks — run these (as any role) any time you want to confirm the
-- containment actually holds:
-- ============================================================================
-- Connected as "app-backend" (or any db_rw member), these should succeed:
--   SELECT count(*) FROM trips;
--   INSERT INTO trips (name, region_line, phase, created_at) VALUES ('x', '', 'ideation', now());
-- ...and these should both fail with a permission error:
--   CREATE TABLE hax (id int);
--   ALTER TABLE trips ADD COLUMN hax int;
