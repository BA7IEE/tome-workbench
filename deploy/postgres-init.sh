#!/bin/sh
set -eu
# Runs only on the first initialization of this dedicated PostgreSQL volume.
APP_PASSWORD=$(cat /run/secrets/app_password)
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 --set=app_password="$APP_PASSWORD" <<'SQL'
CREATE ROLE tome_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE tome_app SET statement_timeout = '20s';
ALTER ROLE tome_app SET lock_timeout = '5s';
ALTER ROLE tome_app SET idle_in_transaction_session_timeout = '30s';
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE tome_production TO tome_app;
GRANT USAGE ON SCHEMA public TO tome_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tome_owner IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO tome_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tome_owner IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO tome_app;
SQL
unset APP_PASSWORD
