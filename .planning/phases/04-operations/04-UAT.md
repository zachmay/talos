---
status: complete
phase: 04-operations
source: [04-01-SUMMARY.md, 04-02-SUMMARY.md, 04-03-SUMMARY.md]
started: 2026-03-28T20:00:00Z
updated: 2026-03-28T20:30:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running containers. Run `docker compose up -d` from scratch. All services start without errors. Database initializes with all schemas (including 07-audit.sql). A basic health check or DB query succeeds.
result: pass

### 2. Audit Log Recording
expected: Perform a write operation through MCP (insert, update, or delete). Check the audit_log table — a row should exist with the correct agent_id, operation, target_id, and timestamp.
result: pass

### 3. Audit Log Query via CLI
expected: Run `./talos audit` (or `./talos audit --operation insert`). Output shows audit log entries in table format with agent, operation, target, and timestamp columns. JSON format works with `--format json`.
result: pass

### 4. Backup Script
expected: Run `./talos backup`. A .dump file appears in the backups/ directory. The script reports success and file size. Running again with default retention (7) keeps the new backup.
result: pass

### 5. Restore Script
expected: Run `./talos restore backups/<latest>.dump`. Script restores the database and runs 5-point verification (pgvector, row counts, RLS, match_entries, audit_log). All checks pass.
result: pass

### 6. Health Check
expected: Run `./talos health`. Output shows pass/fail for each check: DB reachability, pgvector extension, RLS on entries and audit_log, match_entries function, audit_log table, MCP running, compose portability, disk usage. Overall exit code 0 if all pass.
result: pass

### 7. Talos CLI Dispatch
expected: Run `./talos` with no arguments. Shows usage/help listing available commands (backup, restore, audit, health, status, add-agent). Each subcommand dispatches correctly to its script.
result: pass

## Summary

total: 7
passed: 7
issues: 0
pending: 0
skipped: 0

## Gaps

[none]
