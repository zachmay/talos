#!/usr/bin/env bash
# Runs first in initdb.d. Creates extensions and applies schema with
# VECTOR_DIMENSIONS substituted from environment into the template.
set -euo pipefail

INIT_DIR="$(dirname "$0")"
DIMS="${VECTOR_DIMENSIONS:-1536}"

echo "Configuring schema: VECTOR_DIMENSIONS=${DIMS}"

SCHEMA_SQL=$(sed "s/\${VECTOR_DIMENSIONS}/${DIMS}/g" "${INIT_DIR}/03-schema.sql.tpl")

echo "Applying extensions and schema with dimension=${DIMS}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOF
CREATE EXTENSION IF NOT EXISTS vector;

${SCHEMA_SQL}
EOF
echo "Schema applied successfully"
