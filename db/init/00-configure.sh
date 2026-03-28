#!/usr/bin/env bash
# Runs first in initdb.d. Substitutes VECTOR_DIMENSIONS from environment
# into the schema template, producing 03-schema.sql for subsequent execution.
set -euo pipefail

INIT_DIR="$(dirname "$0")"
DIMS="${VECTOR_DIMENSIONS:-1536}"

echo "Configuring schema: VECTOR_DIMENSIONS=${DIMS}"

sed "s/\${VECTOR_DIMENSIONS}/${DIMS}/g" \
    "${INIT_DIR}/03-schema.sql.tpl" \
    > "${INIT_DIR}/03-schema.sql"

echo "Generated 03-schema.sql with dimension=${DIMS}"
