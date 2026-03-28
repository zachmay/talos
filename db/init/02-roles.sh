#!/usr/bin/env bash
# Creates mcp_service role reading password from Docker secret.
# DML grants on tables are added in 06-rls.sql after tables are created.
set -euo pipefail

MCP_PASSWORD=$(cat /run/secrets/mcp_password)

psql -v ON_ERROR_STOP=1 \
     --username "$POSTGRES_USER" \
     --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE ROLE mcp_service WITH LOGIN PASSWORD '${MCP_PASSWORD}';
    GRANT USAGE ON SCHEMA public TO mcp_service;
EOSQL
