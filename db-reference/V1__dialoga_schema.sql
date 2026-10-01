-- Dialoga: schema iniziale PostgreSQL 16+ (V1), 30 settembre 2026.
-- Eseguire su database nuovo, con utente di migrazione; non contiene password.
-- Il database Keycloak deve essere distinto da questo database applicativo.
-- Importi in unità monetarie intere minime; costi IA in NUMERIC, mai FLOAT.
BEGIN;
CREATE SCHEMA dialoga;
SET LOCAL search_path = dialoga, public;

CREATE TABLE app_user (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL CHECK (length(trim(email)) > 0),
    first_name text,
    last_name text,
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','DELETED')),
    last_login_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_identity (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES app_user(id),
    issuer text NOT NULL CHECK (length(issuer)>0),
    subject text NOT NULL CHECK (length(subject)>0),
    UNIQUE (issuer, subject),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX user_identity_user_idx ON user_identity(user_id);
-- Email volutamente non univoca: nessun collegamento automatico di identità per email.

CREATE TABLE organization (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (length(trim(name))>0),
    slug text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','DELETED')),
    conversation_retention_days integer NOT NULL DEFAULT 90 CHECK (conversation_retention_days BETWEEN 1 AND 3650),
    billing_details jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(billing_details)='object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_membership (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    user_id uuid NOT NULL REFERENCES app_user(id),
    role text NOT NULL CHECK (role IN ('OWNER','ADMIN','MEMBER')),
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
    joined_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, user_id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id)
);

CREATE INDEX organization_membership_user_idx ON organization_membership(user_id, status);

CREATE TABLE project (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    name text NOT NULL CHECK (length(trim(name))>0),
    slug text NOT NULL,
    description text,
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
    UNIQUE (organization_id, slug),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id)
);

CREATE TABLE project_membership (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL CHECK (role IN ('MANAGER','EDITOR','OPERATOR','VIEWER')),
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
    UNIQUE (project_id, user_id),
    FOREIGN KEY (organization_id, user_id) REFERENCES organization_membership(organization_id, user_id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, project_id, id),
    FOREIGN KEY (organization_id, project_id) REFERENCES project(organization_id, id)
);

CREATE TABLE organization_permission (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    user_id uuid NOT NULL,
    permission text NOT NULL CHECK (permission IN ('BILLING_MANAGE')),
    FOREIGN KEY (organization_id, user_id) REFERENCES organization_membership(organization_id,user_id),
    UNIQUE (organization_id,user_id,permission),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id)
);

CREATE TABLE project_permission (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    project_id uuid NOT NULL,
    project_membership_id uuid NOT NULL,
    permission text NOT NULL CHECK (permission IN ('ASSISTANT_PUBLISH','CONVERSATION_READ','CONTACT_READ','PERSONAL_DATA_EXPORT','INTEGRATION_MANAGE')),
    FOREIGN KEY (organization_id, project_id, project_membership_id) REFERENCES project_membership(organization_id, project_id, id),
    UNIQUE (project_membership_id, permission),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, project_id, id),
    FOREIGN KEY (organization_id, project_id) REFERENCES project(organization_id, id)
);

CREATE TABLE organization_invite (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    email text NOT NULL,
    token_hash text NOT NULL UNIQUE CHECK (length(token_hash)>=32),
    organization_role text NOT NULL DEFAULT 'MEMBER' CHECK (organization_role IN ('ADMIN','MEMBER')),
    status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','REVOKED')),
    expires_at timestamptz NOT NULL,
    invited_by_user_id uuid NOT NULL,
    accepted_by_user_id uuid REFERENCES app_user(id),
    accepted_at timestamptz,
    FOREIGN KEY (organization_id, invited_by_user_id) REFERENCES organization_membership(organization_id,user_id),
    CHECK ((status='ACCEPTED') = (accepted_at IS NOT NULL AND accepted_by_user_id IS NOT NULL)),
    CHECK (expires_at > created_at),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id)
);

CREATE UNIQUE INDEX invite_pending_email_idx ON organization_invite(organization_id, lower(email)) WHERE status='PENDING';

CREATE TABLE invite_project (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    project_id uuid NOT NULL,
    invite_id uuid NOT NULL,
    role text NOT NULL CHECK (role IN ('MANAGER','EDITOR','OPERATOR','VIEWER')),
    FOREIGN KEY (organization_id, invite_id) REFERENCES organization_invite(organization_id, id),
    UNIQUE (invite_id,project_id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, project_id, id),
    FOREIGN KEY (organization_id, project_id) REFERENCES project(organization_id, id)
);

CREATE TABLE assistant (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    project_id uuid NOT NULL,
    name text NOT NULL CHECK (length(trim(name))>0),
    public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','SUSPENDED')),
    draft_config jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(draft_config)='object'),
    published_version_id uuid,
    draft_lock_version bigint NOT NULL DEFAULT 0 CHECK (draft_lock_version>=0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, project_id, id),
    FOREIGN KEY (organization_id, project_id) REFERENCES project(organization_id, id)
);

CREATE TABLE assistant_domain (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    project_id uuid NOT NULL,
    assistant_id uuid NOT NULL,
    hostname text NOT NULL CHECK (hostname=lower(hostname) AND hostname !~ '[/ :*]'),
    verified_at timestamptz,
    verification_token_hash text,
    UNIQUE (assistant_id,hostname),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, project_id, id),
    FOREIGN KEY (organization_id, project_id) REFERENCES project(organization_id, id),
    UNIQUE (organization_id, project_id, assistant_id, id),
    FOREIGN KEY (organization_id, project_id, assistant_id) REFERENCES assistant(organization_id, project_id, id)
);

CREATE TABLE knowledge_source (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    project_id uuid NOT NULL,
    assistant_id uuid NOT NULL,
    name text NOT NULL,
    source_type text NOT NULL CHECK (source_type IN ('STRUCTURED','TEXT','FAQ','FILE','WEB')),
    enabled boolean NOT NULL DEFAULT true,
    settings jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(settings)='object'),
    refresh_interval_minutes integer CHECK (refresh_interval_minutes>0),
    next_refresh_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, project_id, id),
    FOREIGN KEY (organization_id, project_id) REFERENCES project(organization_id, id),
    UNIQUE (organization_id, project_id, assistant_id, id),
    FOREIGN KEY (organization_id, project_id, assistant_id) REFERENCES assistant(organization_id, project_id, id)
);

CREATE TABLE source_revision (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    project_id uuid NOT NULL,
    assistant_id uuid NOT NULL,
    source_id uuid NOT NULL,
    revision_no integer NOT NULL CHECK (revision_no>0),
    status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','PROCESSING','READY','FAILED')),
    input_payload jsonb NOT NULL DEFAULT '{}',
    checksum text,
    error_code text,
    error_message text,
    processed_at timestamptz,
    UNIQUE (source_id,revision_no),
    FOREIGN KEY (organization_id, project_id, assistant_id, source_id) REFERENCES knowledge_source(organization_id, project_id, assistant_id, id),
    UNIQUE (organization_id,project_id,assistant_id,source_id,id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, project_id, id),
    FOREIGN KEY (organization_id, project_id) REFERENCES project(organization_id, id),
    UNIQUE (organization_id, project_id, assistant_id, id),
    FOREIGN KEY (organization_id, project_id, assistant_id) REFERENCES assistant(organization_id, project_id, id)
);

CREATE TABLE source_document (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    project_id uuid NOT NULL,
    assistant_id uuid NOT NULL,
    source_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    document_key text NOT NULL,
    original_object_key text,
    original_url text,
    mime_type text,
    size_bytes bigint CHECK (size_bytes>=0),
    extracted_text text,
    metadata jsonb NOT NULL DEFAULT '{}',
    UNIQUE (revision_id,document_key),
    FOREIGN KEY (organization_id,project_id,assistant_id,source_id,revision_id) REFERENCES source_revision(organization_id,project_id,assistant_id,source_id,id),
    UNIQUE (organization_id,project_id,assistant_id,revision_id,id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, project_id, id),
    FOREIGN KEY (organization_id, project_id) REFERENCES project(organization_id, id),
    UNIQUE (organization_id, project_id, assistant_id, id),
    FOREIGN KEY (organization_id, project_id, assistant_id) REFERENCES assistant(organization_id, project_id, id)
);

CREATE TABLE knowledge_chunk (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    project_id uuid NOT NULL,
    assistant_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    document_id uuid NOT NULL,
    chunk_no integer NOT NULL CHECK (chunk_no>=0),
    content text NOT NULL,
    token_count integer CHECK (token_count>=0),
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, content)) STORED,
    metadata jsonb NOT NULL DEFAULT '{}',
    UNIQUE (document_id,chunk_no),
    FOREIGN KEY (organization_id,project_id,assistant_id,revision_id,document_id) REFERENCES source_document(organization_id,project_id,assistant_id,revision_id,id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, project_id, id),
    FOREIGN KEY (organization_id, project_id) REFERENCES project(organization_id, id),
    UNIQUE (organization_id, project_id, assistant_id, id),
    FOREIGN KEY (organization_id, project_id, assistant_id) REFERENCES assistant(organization_id, project_id, id)
);

CREATE INDEX knowledge_chunk_search_idx ON knowledge_chunk USING gin(search_vector);

CREATE TABLE assistant_version (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    project_id uuid NOT NULL,
    assistant_id uuid NOT NULL,
    version_no integer NOT NULL CHECK (version_no>0),
    config_snapshot jsonb NOT NULL CHECK (jsonb_typeof(config_snapshot)='object'),
    published_by_user_id uuid NOT NULL,
    published_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (assistant_id,version_no),
    FOREIGN KEY (organization_id,published_by_user_id) REFERENCES organization_membership(organization_id,user_id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, project_id, id),
    FOREIGN KEY (organization_id, project_id) REFERENCES project(organization_id, id),
    UNIQUE (organization_id, project_id, assistant_id, id),
    FOREIGN KEY (organization_id, project_id, assistant_id) REFERENCES assistant(organization_id, project_id, id)
);

CREATE TABLE assistant_version_source (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    project_id uuid NOT NULL,
    assistant_id uuid NOT NULL,
    version_id uuid NOT NULL,
    source_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    FOREIGN KEY (organization_id, project_id, assistant_id, version_id) REFERENCES assistant_version(organization_id, project_id, assistant_id, id),
    FOREIGN KEY (organization_id,project_id,assistant_id,source_id,revision_id) REFERENCES source_revision(organization_id,project_id,assistant_id,source_id,id),
    UNIQUE (version_id,source_id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, project_id, id),
    FOREIGN KEY (organization_id, project_id) REFERENCES project(organization_id, id),
    UNIQUE (organization_id, project_id, assistant_id, id),
    FOREIGN KEY (organization_id, project_id, assistant_id) REFERENCES assistant(organization_id, project_id, id)
);

ALTER TABLE assistant ADD CONSTRAINT assistant_published_version_fk FOREIGN KEY (organization_id,project_id,id,published_version_id) REFERENCES assistant_version(organization_id,project_id,assistant_id,id);
ALTER TABLE assistant ADD CHECK (status<>'PUBLISHED' OR published_version_id IS NOT NULL);

CREATE TABLE conversation (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    project_id uuid NOT NULL,
    assistant_id uuid NOT NULL,
    session_token_hash text NOT NULL UNIQUE,
    channel text NOT NULL CHECK (channel IN ('WIDGET','IFRAME','PUBLIC_PAGE','API','TEST')),
    language text,
    status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','HUMAN_REQUESTED')),
    last_message_at timestamptz,
    expires_at timestamptz NOT NULL,
    retention_until timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, project_id, id),
    FOREIGN KEY (organization_id, project_id) REFERENCES project(organization_id, id),
    UNIQUE (organization_id, project_id, assistant_id, id),
    FOREIGN KEY (organization_id, project_id, assistant_id) REFERENCES assistant(organization_id, project_id, id)
);

CREATE TABLE message (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    project_id uuid NOT NULL,
    assistant_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    sequence_no integer NOT NULL CHECK (sequence_no>0),
    role text NOT NULL CHECK (role IN ('USER','ASSISTANT','OPERATOR','SYSTEM')),
    content text,
    status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETE','FAILED','REDACTED')),
    outcome text CHECK (outcome IN ('ANSWER','NO_SUPPORT','ERROR','HUMAN_HANDOFF')),
    assistant_version_id uuid,
    model_provider text,
    model_name text,
    input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens>=0),
    output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens>=0),
    estimated_cost numeric(20,10) NOT NULL DEFAULT 0 CHECK (estimated_cost>=0),
    cost_currency char(3) NOT NULL DEFAULT 'USD',
    latency_ms integer CHECK (latency_ms>=0),
    operator_user_id uuid,
    client_request_id uuid,
    UNIQUE (conversation_id,sequence_no),
    UNIQUE (conversation_id,client_request_id),
    FOREIGN KEY (organization_id, project_id, assistant_id, conversation_id) REFERENCES conversation(organization_id, project_id, assistant_id, id),
    FOREIGN KEY (organization_id, project_id, assistant_id, assistant_version_id) REFERENCES assistant_version(organization_id, project_id, assistant_id, id),
    FOREIGN KEY (organization_id,operator_user_id) REFERENCES organization_membership(organization_id,user_id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, project_id, id),
    FOREIGN KEY (organization_id, project_id) REFERENCES project(organization_id, id),
    UNIQUE (organization_id, project_id, assistant_id, id),
    FOREIGN KEY (organization_id, project_id, assistant_id) REFERENCES assistant(organization_id, project_id, id)
);

CREATE TABLE message_source (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    project_id uuid NOT NULL,
    assistant_id uuid NOT NULL,
    message_id uuid NOT NULL,
    chunk_id uuid NOT NULL,
    rank integer NOT NULL CHECK (rank>0),
    retrieval_score numeric,
    used_in_prompt boolean NOT NULL DEFAULT true,
    cited_in_answer boolean NOT NULL DEFAULT false,
    FOREIGN KEY (organization_id, project_id, assistant_id, message_id) REFERENCES message(organization_id, project_id, assistant_id, id),
    FOREIGN KEY (organization_id, project_id, assistant_id, chunk_id) REFERENCES knowledge_chunk(organization_id, project_id, assistant_id, id),
    UNIQUE (message_id,chunk_id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, project_id, id),
    FOREIGN KEY (organization_id, project_id) REFERENCES project(organization_id, id),
    UNIQUE (organization_id, project_id, assistant_id, id),
    FOREIGN KEY (organization_id, project_id, assistant_id) REFERENCES assistant(organization_id, project_id, id)
);

CREATE TABLE message_feedback (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    project_id uuid NOT NULL,
    assistant_id uuid NOT NULL,
    message_id uuid NOT NULL UNIQUE,
    rating smallint NOT NULL CHECK (rating IN (-1,1)),
    comment text,
    FOREIGN KEY (organization_id, project_id, assistant_id, message_id) REFERENCES message(organization_id, project_id, assistant_id, id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, project_id, id),
    FOREIGN KEY (organization_id, project_id) REFERENCES project(organization_id, id),
    UNIQUE (organization_id, project_id, assistant_id, id),
    FOREIGN KEY (organization_id, project_id, assistant_id) REFERENCES assistant(organization_id, project_id, id)
);

CREATE TABLE lead (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    project_id uuid NOT NULL,
    assistant_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    name text,
    email text,
    phone text,
    custom_fields jsonb NOT NULL DEFAULT '{}',
    status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','IN_PROGRESS','CLOSED')),
    privacy_notice_version text NOT NULL,
    privacy_notice_acknowledged_at timestamptz NOT NULL,
    marketing_consent boolean NOT NULL DEFAULT false,
    marketing_consent_at timestamptz,
    retention_until timestamptz NOT NULL,
    FOREIGN KEY (organization_id, project_id, assistant_id, conversation_id) REFERENCES conversation(organization_id, project_id, assistant_id, id),
    CHECK (email IS NOT NULL OR phone IS NOT NULL),
    CHECK (NOT marketing_consent OR marketing_consent_at IS NOT NULL),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, project_id, id),
    FOREIGN KEY (organization_id, project_id) REFERENCES project(organization_id, id),
    UNIQUE (organization_id, project_id, assistant_id, id),
    FOREIGN KEY (organization_id, project_id, assistant_id) REFERENCES assistant(organization_id, project_id, id)
);

CREATE TABLE plan (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE,
    name text NOT NULL,
    enabled boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plan_version (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id uuid NOT NULL REFERENCES plan(id),
    version_no integer NOT NULL CHECK (version_no>0),
    price_minor bigint NOT NULL CHECK (price_minor>=0),
    currency char(3) NOT NULL DEFAULT 'EUR',
    billing_interval text NOT NULL CHECK (billing_interval IN ('MONTH','YEAR')),
    max_projects integer NOT NULL CHECK (max_projects>0),
    max_assistants integer NOT NULL CHECK (max_assistants>0),
    max_members integer NOT NULL CHECK (max_members>0),
    storage_bytes bigint NOT NULL CHECK (storage_bytes>=0),
    included_ai_units bigint NOT NULL CHECK (included_ai_units>=0),
    features jsonb NOT NULL DEFAULT '{}',
    payment_price_id text UNIQUE,
    UNIQUE (plan_id,version_no),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscription (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    plan_version_id uuid NOT NULL REFERENCES plan_version(id),
    status text NOT NULL DEFAULT 'TRIALING' CHECK (status IN ('TRIALING','ACTIVE','PAST_DUE','SUSPENDED','CANCELED')),
    current_period_start timestamptz NOT NULL,
    current_period_end timestamptz NOT NULL,
    cancel_at_period_end boolean NOT NULL DEFAULT false,
    payment_customer_id text,
    payment_subscription_id text UNIQUE,
    overage_enabled boolean NOT NULL DEFAULT false,
    overage_limit_minor bigint NOT NULL DEFAULT 0 CHECK (overage_limit_minor>=0),
    UNIQUE (organization_id),
    CHECK (current_period_end>current_period_start),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id)
);

CREATE TABLE subscription_addon (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    subscription_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('PROJECT','ASSISTANT','MEMBER','STORAGE','AI_UNITS')),
    quantity bigint NOT NULL CHECK (quantity>0),
    unit_price_minor bigint NOT NULL CHECK (unit_price_minor>=0),
    currency char(3) NOT NULL DEFAULT 'EUR',
    valid_from timestamptz NOT NULL,
    valid_until timestamptz,
    FOREIGN KEY (organization_id, subscription_id) REFERENCES subscription(organization_id, id),
    CHECK (valid_until IS NULL OR valid_until>valid_from),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id)
);

CREATE TABLE usage_event (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    project_id uuid,
    assistant_id uuid,
    message_id uuid,
    idempotency_key text NOT NULL,
    provider text,
    model text,
    kind text NOT NULL CHECK (kind IN ('CHAT','TEST','EMBEDDING','CRAWL','STORAGE')),
    input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens>=0),
    output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens>=0),
    ai_units bigint NOT NULL DEFAULT 0 CHECK (ai_units>=0),
    meter_version text NOT NULL,
    estimated_cost numeric(20,10) NOT NULL DEFAULT 0 CHECK (estimated_cost>=0),
    cost_currency char(3) NOT NULL DEFAULT 'USD',
    occurred_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id,idempotency_key),
    FOREIGN KEY (organization_id, project_id) REFERENCES project(organization_id, id),
    FOREIGN KEY (organization_id, project_id, assistant_id) REFERENCES assistant(organization_id, project_id, id),
    FOREIGN KEY (organization_id, project_id, assistant_id, message_id) REFERENCES message(organization_id, project_id, assistant_id, id),
    CHECK (assistant_id IS NULL OR project_id IS NOT NULL),
    CHECK (message_id IS NULL OR assistant_id IS NOT NULL),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id)
);

CREATE INDEX usage_event_period_idx ON usage_event(organization_id,occurred_at);

CREATE TABLE billing_webhook_event (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider text NOT NULL,
    external_event_id text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','PROCESSING','DONE','FAILED')),
    payload jsonb NOT NULL,
    processed_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_credential (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    project_id uuid NOT NULL,
    name text NOT NULL,
    key_prefix text NOT NULL,
    secret_hash text NOT NULL UNIQUE,
    scopes text[] NOT NULL,
    expires_at timestamptz,
    revoked_at timestamptz,
    created_by_user_id uuid NOT NULL,
    FOREIGN KEY (organization_id,created_by_user_id) REFERENCES organization_membership(organization_id,user_id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, project_id, id),
    FOREIGN KEY (organization_id, project_id) REFERENCES project(organization_id, id)
);

CREATE TABLE webhook_endpoint (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    project_id uuid NOT NULL,
    url text NOT NULL CHECK (url LIKE 'https://%'),
    secret_ciphertext text NOT NULL,
    events text[] NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, project_id, id),
    FOREIGN KEY (organization_id, project_id) REFERENCES project(organization_id, id)
);

CREATE TABLE webhook_delivery (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    project_id uuid NOT NULL,
    endpoint_id uuid NOT NULL,
    event_id uuid NOT NULL,
    payload jsonb NOT NULL,
    status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','PROCESSING','SENT','FAILED')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    last_http_status integer,
    last_error text,
    FOREIGN KEY (organization_id, project_id, endpoint_id) REFERENCES webhook_endpoint(organization_id, project_id, id),
    UNIQUE (endpoint_id,event_id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, project_id, id),
    FOREIGN KEY (organization_id, project_id) REFERENCES project(organization_id, id)
);

CREATE TABLE job (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    project_id uuid,
    assistant_id uuid,
    source_revision_id uuid,
    kind text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}',
    status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELED')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
    max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts>0),
    run_after timestamptz NOT NULL DEFAULT now(),
    locked_at timestamptz,
    locked_by text,
    last_error text,
    FOREIGN KEY (organization_id, project_id) REFERENCES project(organization_id, id),
    FOREIGN KEY (organization_id, project_id, assistant_id) REFERENCES assistant(organization_id, project_id, id),
    FOREIGN KEY (organization_id, project_id, assistant_id, source_revision_id) REFERENCES source_revision(organization_id, project_id, assistant_id, id),
    CHECK (assistant_id IS NULL OR project_id IS NOT NULL),
    CHECK (source_revision_id IS NULL OR assistant_id IS NOT NULL),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id)
);

CREATE INDEX job_queue_idx ON job(run_after) WHERE status='QUEUED';

CREATE TABLE audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    actor_user_id uuid REFERENCES app_user(id),
    action text NOT NULL,
    object_type text NOT NULL,
    object_id uuid,
    details jsonb NOT NULL DEFAULT '{}',
    occurred_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id)
);

-- Tutti gli aggiornamenti hanno data aggiornata automaticamente.
CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at=now(); RETURN NEW; END $$;

CREATE TRIGGER app_user_touch BEFORE UPDATE ON app_user FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER user_identity_touch BEFORE UPDATE ON user_identity FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER organization_touch BEFORE UPDATE ON organization FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER organization_membership_touch BEFORE UPDATE ON organization_membership FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX organization_membership_tenant_idx ON organization_membership(organization_id);

CREATE TRIGGER project_touch BEFORE UPDATE ON project FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX project_tenant_idx ON project(organization_id);

CREATE TRIGGER project_membership_touch BEFORE UPDATE ON project_membership FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX project_membership_tenant_idx ON project_membership(organization_id);

CREATE TRIGGER organization_permission_touch BEFORE UPDATE ON organization_permission FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX organization_permission_tenant_idx ON organization_permission(organization_id);

CREATE TRIGGER project_permission_touch BEFORE UPDATE ON project_permission FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX project_permission_tenant_idx ON project_permission(organization_id);

CREATE TRIGGER organization_invite_touch BEFORE UPDATE ON organization_invite FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX organization_invite_tenant_idx ON organization_invite(organization_id);

CREATE TRIGGER invite_project_touch BEFORE UPDATE ON invite_project FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX invite_project_tenant_idx ON invite_project(organization_id);

CREATE TRIGGER assistant_touch BEFORE UPDATE ON assistant FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX assistant_tenant_idx ON assistant(organization_id);

CREATE TRIGGER assistant_domain_touch BEFORE UPDATE ON assistant_domain FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX assistant_domain_tenant_idx ON assistant_domain(organization_id);

CREATE TRIGGER knowledge_source_touch BEFORE UPDATE ON knowledge_source FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX knowledge_source_tenant_idx ON knowledge_source(organization_id);

CREATE TRIGGER source_revision_touch BEFORE UPDATE ON source_revision FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX source_revision_tenant_idx ON source_revision(organization_id);

CREATE TRIGGER source_document_touch BEFORE UPDATE ON source_document FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX source_document_tenant_idx ON source_document(organization_id);

CREATE TRIGGER knowledge_chunk_touch BEFORE UPDATE ON knowledge_chunk FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX knowledge_chunk_tenant_idx ON knowledge_chunk(organization_id);

CREATE TRIGGER assistant_version_touch BEFORE UPDATE ON assistant_version FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX assistant_version_tenant_idx ON assistant_version(organization_id);

CREATE TRIGGER assistant_version_source_touch BEFORE UPDATE ON assistant_version_source FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX assistant_version_source_tenant_idx ON assistant_version_source(organization_id);

CREATE TRIGGER conversation_touch BEFORE UPDATE ON conversation FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX conversation_tenant_idx ON conversation(organization_id);

CREATE TRIGGER message_touch BEFORE UPDATE ON message FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX message_tenant_idx ON message(organization_id);

CREATE TRIGGER message_source_touch BEFORE UPDATE ON message_source FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX message_source_tenant_idx ON message_source(organization_id);

CREATE TRIGGER message_feedback_touch BEFORE UPDATE ON message_feedback FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX message_feedback_tenant_idx ON message_feedback(organization_id);

CREATE TRIGGER lead_touch BEFORE UPDATE ON lead FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX lead_tenant_idx ON lead(organization_id);

CREATE TRIGGER plan_touch BEFORE UPDATE ON plan FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER plan_version_touch BEFORE UPDATE ON plan_version FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER subscription_touch BEFORE UPDATE ON subscription FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX subscription_tenant_idx ON subscription(organization_id);

CREATE TRIGGER subscription_addon_touch BEFORE UPDATE ON subscription_addon FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX subscription_addon_tenant_idx ON subscription_addon(organization_id);

CREATE TRIGGER usage_event_touch BEFORE UPDATE ON usage_event FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX usage_event_tenant_idx ON usage_event(organization_id);

CREATE TRIGGER billing_webhook_event_touch BEFORE UPDATE ON billing_webhook_event FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER api_credential_touch BEFORE UPDATE ON api_credential FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX api_credential_tenant_idx ON api_credential(organization_id);

CREATE TRIGGER webhook_endpoint_touch BEFORE UPDATE ON webhook_endpoint FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX webhook_endpoint_tenant_idx ON webhook_endpoint(organization_id);

CREATE TRIGGER webhook_delivery_touch BEFORE UPDATE ON webhook_delivery FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX webhook_delivery_tenant_idx ON webhook_delivery(organization_id);

CREATE TRIGGER job_touch BEFORE UPDATE ON job FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX job_tenant_idx ON job(organization_id);

CREATE TRIGGER audit_log_touch BEFORE UPDATE ON audit_log FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX audit_log_tenant_idx ON audit_log(organization_id);

-- Serializza le modifiche dei membri per organizzazione.
-- Il vincolo differito consente il trasferimento di proprietà nella stessa transazione.
CREATE FUNCTION lock_membership_organization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.organization_id<>OLD.organization_id OR NEW.user_id<>OLD.user_id) THEN
  RAISE EXCEPTION 'Membership keys are immutable';
 END IF;
 IF TG_OP='DELETE' THEN
  PERFORM 1 FROM organization WHERE id=OLD.organization_id FOR UPDATE;
  RETURN OLD;
 END IF;
 PERFORM 1 FROM organization WHERE id=NEW.organization_id FOR UPDATE;
 RETURN NEW;
END $$;
CREATE TRIGGER membership_lock BEFORE INSERT OR UPDATE OR DELETE ON organization_membership
FOR EACH ROW EXECUTE FUNCTION lock_membership_organization();
CREATE FUNCTION require_active_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org_id uuid;
BEGIN
 IF TG_TABLE_NAME='organization' THEN
  org_id=NEW.id;
 ELSIF TG_OP='DELETE' THEN org_id=OLD.organization_id;
 ELSE org_id=NEW.organization_id;
 END IF;
 IF EXISTS (SELECT 1 FROM organization WHERE id=org_id AND status<>'DELETED')
 AND NOT EXISTS (SELECT 1 FROM organization_membership WHERE organization_id=org_id AND role='OWNER' AND status='ACTIVE') THEN
  RAISE EXCEPTION 'Organization % requires an active owner',org_id USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER organization_owner_required AFTER INSERT OR UPDATE ON organization
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_active_owner();
CREATE CONSTRAINT TRIGGER membership_owner_required AFTER INSERT OR UPDATE OR DELETE ON organization_membership
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_active_owner();
-- READY rende immutabile la revisione. Aggiornamenti richiedono una nuova revisione.
CREATE FUNCTION protect_ready_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='READY' THEN RAISE EXCEPTION 'Ready revision cannot be modified'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER revision_immutable BEFORE UPDATE ON source_revision FOR EACH ROW EXECUTE FUNCTION protect_ready_revision();
CREATE FUNCTION protect_ready_document() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rev_id uuid; rev_status text;
BEGIN
 IF TG_OP='DELETE' THEN rev_id=OLD.revision_id; ELSE rev_id=NEW.revision_id; END IF;
 IF TG_OP='UPDATE' AND (NEW.revision_id<>OLD.revision_id OR NEW.assistant_id<>OLD.assistant_id OR NEW.organization_id<>OLD.organization_id OR NEW.project_id<>OLD.project_id) THEN
  RAISE EXCEPTION 'Document/chunk scope is immutable';
 END IF;
 SELECT status INTO rev_status FROM source_revision WHERE id=rev_id FOR UPDATE;
 IF rev_status='READY' AND TG_OP<>'DELETE' THEN RAISE EXCEPTION 'Ready revision content cannot be modified'; END IF;
 -- DELETE ammesso per rimozione/privacy, con FK che proteggono riferimenti esistenti.
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER document_immutable BEFORE INSERT OR UPDATE OR DELETE ON source_document FOR EACH ROW EXECUTE FUNCTION protect_ready_document();
CREATE TRIGGER chunk_immutable BEFORE INSERT OR UPDATE OR DELETE ON knowledge_chunk FOR EACH ROW EXECUTE FUNCTION protect_ready_document();
CREATE FUNCTION require_ready_version_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM source_revision WHERE id=NEW.revision_id AND status='READY' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Published source revision must be READY'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER published_source_ready BEFORE INSERT ON assistant_version_source FOR EACH ROW EXECUTE FUNCTION require_ready_version_source();
-- Versioni pubblicate e collegamenti non si aggiornano; eliminazione solo per purge.
CREATE FUNCTION reject_snapshot_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Published snapshot is immutable'; END $$;
CREATE TRIGGER version_immutable BEFORE UPDATE ON assistant_version FOR EACH ROW EXECUTE FUNCTION reject_snapshot_update();
CREATE TRIGGER version_source_immutable BEFORE UPDATE ON assistant_version_source FOR EACH ROW EXECUTE FUNCTION reject_snapshot_update();
COMMIT;
