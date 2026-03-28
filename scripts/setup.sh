#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS_DIR="$REPO_ROOT/secrets"
mkdir -p "$SECRETS_DIR"

generate_secret() {
    local file="$1"
    if [[ -f "$file" ]]; then
        echo "  Skipping $(basename $file) (already exists)"
    else
        openssl rand -base64 32 | tr -d '\n' > "$file"
        chmod 600 "$file"
        echo "  Generated $(basename $file)"
    fi
}

echo "Generating secrets..."
generate_secret "$SECRETS_DIR/db_password.txt"
generate_secret "$SECRETS_DIR/mcp_password.txt"

# Phase 2 placeholder — embedding API key is not used until Phase 2
if [[ -f "$SECRETS_DIR/embedding_api_key.txt" ]]; then
    echo "  Skipping embedding_api_key.txt (already exists)"
else
    echo "REPLACE_WITH_YOUR_EMBEDDING_API_KEY" > "$SECRETS_DIR/embedding_api_key.txt"
    chmod 600 "$SECRETS_DIR/embedding_api_key.txt"
    echo "  Created embedding_api_key.txt placeholder — update before Phase 2"
fi

echo ""
echo "Done. Run 'docker compose up' to start services."
echo "Note: Update secrets/embedding_api_key.txt before Phase 2 work."
