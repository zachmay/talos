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

# Embedding API key
if [[ -f "$SECRETS_DIR/embedding_api_key.txt" ]]; then
    echo "  Skipping embedding_api_key.txt (already exists)"
else
    echo "REPLACE_WITH_YOUR_EMBEDDING_API_KEY" > "$SECRETS_DIR/embedding_api_key.txt"
    chmod 600 "$SECRETS_DIR/embedding_api_key.txt"
    echo "  Created embedding_api_key.txt placeholder — update before use"
fi

# Agent keys for MCP authentication
if [[ -f "$SECRETS_DIR/agent_keys.json" ]]; then
    echo "  Skipping agent_keys.json (already exists)"
else
    DEFAULT_KEY=$(openssl rand -base64 32 | tr -d '\n')
    printf '{\n  "%s": "default-agent"\n}\n' "$DEFAULT_KEY" > "$SECRETS_DIR/agent_keys.json"
    chmod 600 "$SECRETS_DIR/agent_keys.json"
    echo "  Generated agent_keys.json with default agent key"
fi

# LibreChat env file
LIBRECHAT_ENV="$REPO_ROOT/librechat.env"
if [[ -f "$LIBRECHAT_ENV" ]]; then
    echo "  Skipping librechat.env (already exists)"
else
    CREDS_KEY=$(openssl rand -hex 32)
    CREDS_IV=$(openssl rand -hex 16)
    JWT_SECRET=$(openssl rand -hex 32)

    cat > "$LIBRECHAT_ENV" <<EOF
HOST=0.0.0.0
PORT=3080

MONGO_URI=mongodb://mongodb:27017/librechat

# Auth credentials encryption
CREDS_KEY=${CREDS_KEY}
CREDS_IV=${CREDS_IV}
JWT_SECRET=${JWT_SECRET}

# LLM API keys — uncomment and fill in as needed
# ANTHROPIC_API_KEY=
# OPENAI_API_KEY=
EOF
    chmod 600 "$LIBRECHAT_ENV"
    echo "  Generated librechat.env"
fi

echo ""
echo "Done. Run 'docker compose up' to start services."
echo "Secrets: db_password.txt, mcp_password.txt, embedding_api_key.txt, agent_keys.json"
echo "Config:  librechat.env"
