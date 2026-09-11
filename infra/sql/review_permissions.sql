-- Read-only queries to review whatever provision_roles.sql has actually
-- put in place on a real server: roles, memberships, ownership, and
-- grants. Nothing here writes anything. Run connected as the Entra
-- Administrator (or any role -- catalog/ACL visibility below doesn't
-- require azure_pg_admin, unlike the pgaadauth_* functions):
--
--   PGPASSWORD="$(az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv)" \
--     psql "host=<postgresFqdn output> dbname=vacation_planner user=<your-email> sslmode=require" \
--     -f infra/sql/review_permissions.sql
--
-- Compare results against infra/sql/provision_roles.sql's intent and
-- claude/db-privilege-provisioning.md's decision record: db_owner owns
-- everything; db_rw and app-backend can read/write only; gh-deploy and
-- maintainers (db_owner members) can do DDL; PUBLIC has nothing.

-- ============================================================================
-- 1. Which AAD identities are mapped to which Postgres roles (Azure
--    Flexible Server's own extension function -- inspect a row first if
--    the column names below don't match your server's version).
-- ============================================================================
SELECT * FROM pgaadauth_list_principals(false);

-- ============================================================================
-- 2. Roles that exist, and their basic attributes. db_owner/db_rw should
--    both show NOLOGIN; everything else (your email, app-backend,
--    gh-deploy) should show LOGIN (Azure AD principals are always
--    NOSUPERUSER/NOCREATEROLE/NOCREATEDB here).
-- ============================================================================
SELECT
  rolname,
  rolcanlogin   AS can_login,
  rolsuper      AS superuser,
  rolcreaterole AS can_create_role,
  rolcreatedb   AS can_create_db
FROM pg_roles
WHERE rolname NOT LIKE 'pg\_%'
  AND rolname NOT IN ('azure_pg_admin', 'azure_superuser', 'azuresu', 'azure_admin')
ORDER BY rolname;

-- ============================================================================
-- 3. Role memberships -- who is a member of db_owner / db_rw, with or
--    without ADMIN OPTION, and (Postgres 16+) whether the membership
--    inherits privileges automatically. Expect: your email (and any other
--    maintainer) + gh-deploy as members of db_owner; app-backend as the
--    only member of db_rw. app-backend and gh-deploy should NOT appear as
--    members of each other's role, and neither should be a member of
--    db_owner AND have inherit_option = true unless that's deliberate.
-- ============================================================================
SELECT
  granted.rolname AS role,
  member.rolname  AS member,
  m.admin_option,
  m.inherit_option
FROM pg_auth_members m
JOIN pg_roles member  ON member.oid  = m.member
JOIN pg_roles granted ON granted.oid = m.roleid
WHERE granted.rolname IN ('db_owner', 'db_rw')
ORDER BY role, member;

-- ============================================================================
-- 4. Table ownership -- every table in `public` should be owned by
--    db_owner. Anything else here is a red flag (an app-created table
--    that bypassed `SET ROLE db_owner`, most likely from when app-backend
--    briefly held db_owner directly).
-- ============================================================================
SELECT tablename, tableowner
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- Same, but only the offenders (should return zero rows):
SELECT tablename, tableowner
FROM pg_tables
WHERE schemaname = 'public' AND tableowner <> 'db_owner';

-- ============================================================================
-- 5. Explicit table + sequence grants, exploded into one row per
--    (object, grantee, privilege). db_rw and app-backend should only ever
--    show SELECT/INSERT/UPDATE/DELETE (tables) or USAGE/SELECT/UPDATE
--    (sequences); db_owner should show everything (it's the owner, which
--    implies all privileges even where this listing shows none granted
--    explicitly -- ownership isn't itself an ACL entry).
-- ============================================================================
SELECT
  n.nspname                                AS schema,
  c.relname                                AS object_name,
  CASE c.relkind WHEN 'r' THEN 'table' WHEN 'S' THEN 'sequence' ELSE c.relkind::text END AS object_type,
  (aclexplode(c.relacl)).grantee::regrole  AS grantee,
  (aclexplode(c.relacl)).privilege_type    AS privilege,
  (aclexplode(c.relacl)).is_grantable      AS is_grantable
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'S')
ORDER BY object_name, grantee, privilege;

-- Rows where grantee is PUBLIC show up with grantee NULL above (regrole
-- can't cast oid 0) -- check for those separately; expect zero rows
-- (step 3 in provision_roles.sql explicitly revokes ALL from PUBLIC):
SELECT n.nspname AS schema, c.relname AS object_name,
       (aclexplode(c.relacl)).privilege_type AS privilege_granted_to_public
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'S')
  AND (aclexplode(c.relacl)).grantee = 0;

-- ============================================================================
-- 6. Default privileges -- what db_owner's ALTER DEFAULT PRIVILEGES
--    (provision_roles.sql step 4) actually promises to every table/
--    sequence created from now on. Expect one row granting db_rw
--    SELECT/INSERT/UPDATE/DELETE on tables, one granting it USAGE/SELECT/
--    UPDATE on sequences -- both "for role db_owner", schema public.
-- ============================================================================
SELECT
  pg_get_userbyid(a.defaclrole) AS default_privileges_for_role,
  n.nspname                     AS schema,
  CASE a.defaclobjtype
    WHEN 'r' THEN 'table' WHEN 'S' THEN 'sequence'
    WHEN 'f' THEN 'function' WHEN 'T' THEN 'type' ELSE a.defaclobjtype::text
  END                            AS object_type,
  (aclexplode(a.defaclacl)).grantee::regrole AS grantee,
  (aclexplode(a.defaclacl)).privilege_type   AS privilege
FROM pg_default_acl a
LEFT JOIN pg_namespace n ON n.oid = a.defaclnamespace
ORDER BY schema, object_type, grantee;

-- ============================================================================
-- 7. Database- and schema-level grants. Expect: CONNECT + TEMPORARY on
--    the database for db_owner and db_rw; USAGE + CREATE on schema
--    public for db_owner; USAGE only on schema public for db_rw.
-- ============================================================================
SELECT (aclexplode(datacl)).grantee::regrole AS grantee,
       (aclexplode(datacl)).privilege_type   AS privilege
FROM pg_database WHERE datname = 'vacation_planner';

SELECT (aclexplode(nspacl)).grantee::regrole AS grantee,
       (aclexplode(nspacl)).privilege_type   AS privilege
FROM pg_namespace WHERE nspname = 'public';

-- ============================================================================
-- 8. Functional "prove it" checks -- these need separate connections as
--    each role (Azure AD auth means you can't just `SET ROLE` your way
--    into app-backend/gh-deploy's own login from your maintainer
--    session), so run each block connected AS that identity, not as
--    yourself:
--
--   Connected as app-backend (get a token the same way the app does, or
--   temporarily via your own admin session + `SET ROLE "app-backend"` if
--   you're a member -- you're not, by design, so this really does need
--   the app's own credential):
--     SELECT count(*) FROM trips;                                  -- should succeed
--     INSERT INTO trips (name, region_line, phase, created_at)
--       VALUES ('x', '', 'ideation', now());                       -- should succeed
--     CREATE TABLE hax (id int);                                   -- should FAIL
--
--   Connected as gh-deploy (or as yourself with `SET ROLE db_owner` --
--   you ARE a member, so this one works from your own session):
--     SET ROLE db_owner;  -- skip if actually connected as gh-deploy
--     CREATE TABLE hax (id int); DROP TABLE hax;                    -- should succeed
--     RESET ROLE;
-- ============================================================================
