-- Local test only. Production credentials and grants must be managed separately.
CREATE ROLE dialoga_app LOGIN PASSWORD 'dialoga_local_app';
GRANT CONNECT ON DATABASE dialoga TO dialoga_app;
GRANT USAGE ON SCHEMA dialoga TO dialoga_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA dialoga TO dialoga_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA dialoga TO dialoga_app;
