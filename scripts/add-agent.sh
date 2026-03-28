#!/usr/bin/env bash
# scripts/add-agent.sh — Provision a new agent identity
# Phase 3 introduced setup.sh for secret generation.
# This script is the Phase 4 operational entry point; extend as needed.
set -euo pipefail

AGENT_NAME="${1:-}"
if [[ -z "$AGENT_NAME" ]]; then
  echo "Usage: ./talos add-agent <name>"
  exit 1
fi

echo "Provisioning agent: $AGENT_NAME"
echo "[TODO] Extend this script to:"
echo "  1. Generate agent JWT secret"
echo "  2. Register agent in DB (if applicable)"
echo "  3. Output agent credentials"
echo ""
echo "For now, manually add agent credentials to your Docker secrets."
