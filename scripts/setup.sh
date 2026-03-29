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

# Agent keys for MCP authentication
if [[ -f "$SECRETS_DIR/agent_keys.json" ]]; then
    echo "  Skipping agent_keys.json (already exists)"
else
    DEFAULT_KEY=$(openssl rand -base64 32 | tr -d '\n')
    printf '{\n  "%s": "default-agent"\n}\n' "$DEFAULT_KEY" > "$SECRETS_DIR/agent_keys.json"
    chmod 600 "$SECRETS_DIR/agent_keys.json"
    echo "  Generated agent_keys.json with default agent key"
fi

# TUI access token
if [[ -f "$SECRETS_DIR/tui_token" ]]; then
    echo "  Skipping tui_token (already exists)"
else
    openssl rand -hex 32 > "$SECRETS_DIR/tui_token"
    chmod 600 "$SECRETS_DIR/tui_token"
    echo "  Generated TUI access token"
fi

# Agent LLM API key
if [[ -f "$SECRETS_DIR/agent_llm_key.txt" ]]; then
    echo "  Skipping agent_llm_key.txt (already exists)"
else
    read -rp "Enter AGENT_LLM_API_KEY (Anthropic/OpenRouter/Ollama key, or press Enter to set later): " LLM_KEY
    if [[ -z "$LLM_KEY" ]]; then
        LLM_KEY="CHANGEME_AGENT_LLM_KEY"
        echo "  WARNING: agent_llm_key.txt set to placeholder — update before running agent"
    fi
    printf '%s' "$LLM_KEY" > "$SECRETS_DIR/agent_llm_key.txt"
    chmod 600 "$SECRETS_DIR/agent_llm_key.txt"
    echo "  Created agent_llm_key.txt"
fi

echo ""
echo "Done. Run 'docker compose up' to start services."
echo "Secrets generated: db_password.txt, mcp_password.txt, embedding_api_key.txt, agent_keys.json, agent_llm_key.txt, tui_token"
