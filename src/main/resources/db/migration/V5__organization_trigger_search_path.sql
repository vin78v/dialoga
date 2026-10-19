-- Apply as migration owner, including on databases already initialized with V1.
-- These invoker functions must resolve application tables independently of the
-- runtime role's search_path. RLS and runtime privileges remain in effect.
BEGIN;
ALTER FUNCTION dialoga.lock_membership_organization()
    SET search_path = pg_catalog, dialoga, pg_temp;
ALTER FUNCTION dialoga.require_active_owner()
    SET search_path = pg_catalog, dialoga, pg_temp;
COMMIT;
