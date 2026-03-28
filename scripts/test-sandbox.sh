#!/usr/bin/env bash
# Sandbox Isolation Smoke Tests for Talos Agent Container
#
# Prerequisites:
#   - Build the agent image first: docker compose build agent
#   - The 'strict' profile (gVisor runtime) requires a Linux host
#
# Run from repo root: ./scripts/test-sandbox.sh

set -euo pipefail

FAILURES=0

echo "=== Sandbox Isolation Smoke Tests ==="
echo ""

# Test 1 — Read-only rootfs
echo -n "Test 1: Read-only rootfs... "
OUTPUT=$(docker compose run --rm agent sh -c "touch /test-rw 2>&1 || true" 2>/dev/null)
if echo "$OUTPUT" | grep -q "Read-only\|Permission denied"; then
  echo "PASS: rootfs is read-only"
else
  echo "FAIL: rootfs is writable"
  FAILURES=$((FAILURES + 1))
fi

# Test 2 — tmpfs workspace is writable
echo -n "Test 2: Writable workspace... "
if docker compose run --rm agent sh -c "touch /app/workspace/test-w && echo OK" 2>/dev/null | grep -q "OK"; then
  echo "PASS: workspace writable"
else
  echo "FAIL: workspace not writable"
  FAILURES=$((FAILURES + 1))
fi

# Test 3 — No privilege escalation
echo -n "Test 3: su blocked... "
OUTPUT=$(docker compose run --rm agent sh -c "su root 2>&1 || true" 2>/dev/null)
if echo "$OUTPUT" | grep -q "Permission\|not found\|su:\|appuser"; then
  echo "PASS: su blocked"
else
  echo "WARN: su may be available"
fi

# Test 4 — Non-root user
echo -n "Test 4: Non-root user... "
if docker compose run --rm agent id 2>/dev/null | grep -q "uid=0"; then
  echo "FAIL: running as root"
  FAILURES=$((FAILURES + 1))
else
  echo "PASS: non-root user"
fi

echo ""
if [ "$FAILURES" -gt 0 ]; then
  echo "RESULT: $FAILURES test(s) FAILED"
  exit 1
else
  echo "RESULT: All tests passed"
  exit 0
fi
