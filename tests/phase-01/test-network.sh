#!/usr/bin/env bash
set -euo pipefail
echo "=== Network isolation checks ==="
# Agent should NOT reach DB (different network)
if docker compose exec agent ping -c 1 -W 2 db > /dev/null 2>&1; then
    echo "FAIL INF-02: agent can reach db — network isolation broken"
    exit 1
else
    echo "PASS INF-02: agent cannot reach db (DNS failure or timeout — expected)"
fi
# MCP should reach DB
if docker compose exec mcp ping -c 1 -W 2 db > /dev/null 2>&1; then
    echo "PASS INF-02: mcp can reach db"
else
    echo "FAIL INF-02: mcp cannot reach db"
    exit 1
fi
# Agent should reach MCP
if docker compose exec agent ping -c 1 -W 2 mcp > /dev/null 2>&1; then
    echo "PASS INF-02: agent can reach mcp"
else
    echo "FAIL INF-02: agent cannot reach mcp"
    exit 1
fi
echo "Network topology verified."
