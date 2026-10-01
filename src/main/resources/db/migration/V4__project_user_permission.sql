-- Additive migration: explicit sensitive grants also work for org-level OWNER/ADMIN.
BEGIN;
SET LOCAL search_path = dialoga, public;

CREATE OR REPLACE FUNCTION dialoga.current_organization_id() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT NULLIF(current_setting('app.organization_id',true),'')::uuid
$$;

CREATE TABLE project_user_permission (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    permission text NOT NULL CHECK (permission IN ('PERSONAL_DATA_EXPORT')),
    granted_by_user_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, project_id, user_id, permission),
    FOREIGN KEY (organization_id, project_id)
        REFERENCES project(organization_id, id),
    FOREIGN KEY (organization_id, user_id)
        REFERENCES organization_membership(organization_id, user_id),
    FOREIGN KEY (organization_id, granted_by_user_id)
        REFERENCES organization_membership(organization_id, user_id)
);
CREATE INDEX project_user_permission_user_idx
    ON project_user_permission(organization_id, project_id, user_id);

ALTER TABLE project_user_permission ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_user_permission FORCE ROW LEVEL SECURITY;
CREATE POLICY project_user_permission_tenant_policy
    ON project_user_permission
    USING (organization_id = dialoga.current_organization_id())
    WITH CHECK (organization_id = dialoga.current_organization_id());
COMMIT;
