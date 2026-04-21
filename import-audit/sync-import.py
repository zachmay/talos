#!/usr/bin/env python3
"""Sync Obsidian vault → Talos DB.

Idempotent: can be re-run as the vault changes.
- New files → insert
- Modified files (frontmatter.updated newer than DB.metadata.updated) → update
- Deleted files → flagged as orphans (optional --delete-orphans to remove)

Usage:
  sync-import.py                    Show summary, then prompt before changes
  sync-import.py --dry-run          Show what would change without doing it
  sync-import.py --yes              Apply changes without prompting
  sync-import.py --delete-orphans   Delete DB entries whose source file is gone
"""

import argparse
import importlib.util
import json
import subprocess
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

AUDIT = Path(__file__).parent
VAULT = Path.home() / "Documents" / "Exocortex"
MCP_URL = "http://localhost:3001/mcp"
API_KEY = "xXK3iCr/MBOhsJ72ONFEoA8mHAxwK20oHJQvDFh7OIM="
GUID_INDEX = AUDIT / "title-guid-index.json"

# --- Load build-full-manifest.py as a module ---
spec = importlib.util.spec_from_file_location(
    "builder", AUDIT / "build-full-manifest.py"
)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


# --- MCP helpers ---

def mcp_request(method, params, session_id=None, req_id=1):
    body = {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params}
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}",
        "Accept": "application/json, text/event-stream",
    }
    if session_id:
        headers["mcp-session-id"] = session_id
    req = urllib.request.Request(MCP_URL, data=json.dumps(body).encode(), headers=headers)
    resp = urllib.request.urlopen(req, timeout=120)
    ct = resp.headers.get("Content-Type", "")
    raw = resp.read().decode()
    sid = resp.headers.get("mcp-session-id")
    if "text/event-stream" in ct:
        results = []
        for line in raw.split("\n"):
            if line.startswith("data: "):
                try:
                    results.append(json.loads(line[6:]))
                except json.JSONDecodeError:
                    pass
        return results, sid
    return [json.loads(raw)], sid


def init_session():
    results, sid = mcp_request("initialize", {
        "protocolVersion": "2025-03-26",
        "capabilities": {},
        "clientInfo": {"name": "sync-import", "version": "1.0"},
    })
    return sid


def call_tool(session_id, tool_name, arguments, req_id=1):
    results, _ = mcp_request("tools/call", {
        "name": tool_name,
        "arguments": arguments,
    }, session_id=session_id, req_id=req_id)
    return results


def parse_result(results):
    """Extract the parsed result dict from an MCP tool response."""
    for r in results:
        if "result" in r:
            content = r["result"].get("content", [])
            for c in content:
                if c.get("type") == "text":
                    try:
                        return json.loads(c["text"])
                    except json.JSONDecodeError:
                        pass
    return None


def insert_entry(session_id, entry, req_id=1):
    args = {
        "content": entry["content"],
        "title": entry["title"],
        "type": entry["type"],
        "mime_type": entry.get("mime_type", "text/markdown"),
        "path": entry["path"],
        "metadata": entry["metadata"],
        "verbose": True,
    }
    return parse_result(call_tool(session_id, "insert", args, req_id=req_id))


def update_entry(session_id, guid, entry, req_id=1):
    # MCP update requires if_match — fetch the current etag first. Adds one
    # round trip per update; acceptable for a batch operation. If another
    # writer races between our get and our update, the server will reject
    # and we surface the conflict.
    current = parse_result(call_tool(session_id, "get", {"id": guid}, req_id=req_id * 2 + 1))
    if not current or "etag" not in current:
        return {"error": "NO_ETAG", "message": f"could not fetch etag for {guid}"}
    args = {
        "id": guid,
        "if_match": current["etag"],
        "title": entry["title"],
        "type": entry["type"],
        "mime_type": entry.get("mime_type", "text/markdown"),
        "metadata": entry["metadata"],
        "verbose": True,
    }
    # Only include content if non-empty (update tool rejects empty)
    if entry["content"]:
        args["content"] = entry["content"]
    return parse_result(call_tool(session_id, "update", args, req_id=req_id * 2))


def delete_entry(session_id, guid, req_id=1):
    return parse_result(call_tool(session_id, "delete", {"id": guid}, req_id=req_id))


# --- Direct DB query ---

def fetch_db_obsidian():
    """Return {original_source: {id, title, content, updated, metadata}} for all obsidian DB
    entries, excluding Roam (frozen archive — sync doesn't apply)."""
    sql = (
        "SET app.agent_id = 'default-agent'; "
        "SELECT json_build_object("
        "'id', id, "
        "'original_source', metadata->'_import'->>'original', "
        "'title', title, "
        "'content', content, "
        "'updated', metadata->>'updated', "
        "'metadata', metadata) "
        "FROM entries WHERE metadata->'_import'->>'source' = 'obsidian' "
        "  AND (metadata->'_import'->>'original') NOT LIKE '/Roam/%';"
    )
    result = subprocess.run(
        ["docker", "compose", "exec", "-T", "db",
         "psql", "-U", "mcp_service", "-d", "talos",
         "-t", "-A", "-c", sql],
        capture_output=True, text=True, check=True,
    )
    by_source = {}
    for line in result.stdout.strip().split("\n"):
        line = line.strip()
        if not line or line == "SET":
            continue
        try:
            row = json.loads(line)
            src = row.get("original_source")
            if src:
                by_source[src] = row
        except json.JSONDecodeError:
            pass
    return by_source


# --- Time comparison ---

def parse_time(s):
    """Parse a timestamp string. Returns datetime or None."""
    if not s:
        return None
    s = str(s).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(s.split(".")[0].replace("Z", ""), fmt)
        except ValueError:
            continue
    return None


# --- Diff vault vs DB ---

# Metadata keys excluded from the user-metadata diff:
# _import is Talos-owned provenance; created/updated are timestamp signals handled separately.
META_DIFF_IGNORE = {"_import", "created", "updated"}


def user_meta(m):
    """Return metadata dict with non-user keys stripped, for diffing."""
    return {k: v for k, v in (m or {}).items() if k not in META_DIFF_IGNORE}


def diff(manifest, db_by_source):
    new = []
    changed = []
    unchanged = []

    for entry in manifest:
        src = entry["metadata"]["_import"]["original"]
        db_row = db_by_source.get(src)
        if not db_row:
            new.append(entry)
            continue

        file_time = parse_time(entry["metadata"].get("updated"))
        db_time = parse_time(db_row.get("updated"))
        time_changed = file_time and db_time and file_time > db_time
        # Detect title/content/metadata mismatch independent of timestamps
        # (catches edits made without bumping the 'updated' frontmatter field)
        title_changed = entry.get("title") != db_row.get("title")
        content_changed = entry.get("content", "") != (db_row.get("content") or "")
        meta_changed = user_meta(entry.get("metadata")) != user_meta(db_row.get("metadata"))
        if time_changed or title_changed or content_changed or meta_changed:
            changed.append((db_row["id"], entry))
        else:
            unchanged.append(entry)

    vault_sources = {e["metadata"]["_import"]["original"] for e in manifest}
    orphans = [row for src, row in db_by_source.items() if src not in vault_sources]

    return new, changed, unchanged, orphans


# --- Main ---

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Show changes without applying")
    ap.add_argument("--yes", action="store_true", help="Apply without prompting")
    ap.add_argument("--delete-orphans", action="store_true", help="Delete DB entries whose source file is gone")
    args = ap.parse_args()

    print("Building manifest from current vault state...")
    manifest, _, _ = builder.build_manifest()
    print(f"  Vault files: {len(manifest)}")

    print("Fetching DB state...")
    db_by_source = fetch_db_obsidian()
    print(f"  DB entries (source=obsidian): {len(db_by_source)}")

    print("Diffing...")
    new, changed, unchanged, orphans = diff(manifest, db_by_source)

    print(f"\n--- SYNC PLAN ---")
    print(f"  NEW       (insert): {len(new)}")
    print(f"  CHANGED   (update): {len(changed)}")
    print(f"  UNCHANGED (skip):   {len(unchanged)}")
    print(f"  ORPHANS   (delete only if --delete-orphans): {len(orphans)}")

    if new and len(new) <= 20:
        print("\nNew:")
        for e in new:
            print(f"  + {e['metadata']['_import']['original']}")
    elif new:
        print(f"\nFirst 20 new:")
        for e in new[:20]:
            print(f"  + {e['metadata']['_import']['original']}")
        print(f"  ... and {len(new) - 20} more")

    if changed and len(changed) <= 20:
        print("\nChanged:")
        for guid, e in changed:
            print(f"  ~ {e['metadata']['_import']['original']}")
    elif changed:
        print(f"\nFirst 20 changed:")
        for guid, e in changed[:20]:
            print(f"  ~ {e['metadata']['_import']['original']}")
        print(f"  ... and {len(changed) - 20} more")

    if orphans:
        print("\nOrphans (DB entries with no source file):")
        for o in orphans[:20]:
            print(f"  ? {o['original_source']}")
        if len(orphans) > 20:
            print(f"  ... and {len(orphans) - 20} more")

    if args.dry_run:
        print("\n[dry-run] No changes applied.")
        return

    total_changes = len(new) + len(changed) + (len(orphans) if args.delete_orphans else 0)
    if total_changes == 0:
        print("\nNothing to do.")
        return

    if not args.yes:
        resp = input(f"\nApply {total_changes} changes? [y/N] ").strip().lower()
        if resp != "y":
            print("Aborted.")
            return

    # Load GUID index for checkpointing
    guid_index = {}
    if GUID_INDEX.exists():
        with open(GUID_INDEX) as f:
            guid_index = json.load(f)

    session_id = init_session()
    print(f"\nSession: {session_id}")

    # Apply inserts
    inserted = 0
    errors = 0
    for i, entry in enumerate(new):
        try:
            result = insert_entry(session_id, entry, req_id=i + 1)
            if result and "id" in result:
                guid_index[entry["metadata"]["_import"]["original"]] = result["id"]
                inserted += 1
            else:
                print(f"  ERROR insert '{entry['title']}': {result}")
                errors += 1
        except Exception as e:
            print(f"  ERROR insert '{entry['title']}': {e}")
            errors += 1
            try:
                session_id = init_session()
            except Exception:
                time.sleep(3)
                session_id = init_session()
        if (i + 1) % 50 == 0:
            with open(GUID_INDEX, "w") as f:
                json.dump(guid_index, f, indent=2)
            print(f"  [inserts {i+1}/{len(new)}] checkpoint saved")

    # Apply updates
    updated = 0
    for i, (guid, entry) in enumerate(changed):
        try:
            result = update_entry(session_id, guid, entry, req_id=i + 10000)
            if result and ("id" in result or not result.get("error")):
                updated += 1
            else:
                print(f"  ERROR update '{entry['title']}': {result}")
                errors += 1
        except Exception as e:
            print(f"  ERROR update '{entry['title']}': {e}")
            errors += 1
        if (i + 1) % 50 == 0:
            print(f"  [updates {i+1}/{len(changed)}]")

    # Apply orphan deletes
    deleted = 0
    if args.delete_orphans:
        for i, orphan in enumerate(orphans):
            try:
                delete_entry(session_id, orphan["id"], req_id=i + 20000)
                deleted += 1
                # Remove from GUID index
                src = orphan.get("original_source")
                if src and src in guid_index:
                    del guid_index[src]
            except Exception as e:
                print(f"  ERROR delete '{orphan['original_source']}': {e}")
                errors += 1

    # Final save
    with open(GUID_INDEX, "w") as f:
        json.dump(guid_index, f, indent=2)

    # Fix timestamps for new + updated entries
    if inserted > 0 or updated > 0:
        print("\nFixing created_at/updated_at from frontmatter...")
        subprocess.run(
            ["docker", "compose", "exec", "-T", "db",
             "psql", "-U", "mcp_service", "-d", "talos", "-c",
             "SET app.agent_id = 'default-agent'; "
             "UPDATE entries SET "
             "  created_at = (metadata->>'created')::timestamptz, "
             "  updated_at = (metadata->>'updated')::timestamptz "
             "WHERE metadata->'_import'->>'source' = 'obsidian' "
             "  AND metadata->>'created' IS NOT NULL;"],
            check=True,
        )

    print(f"\n--- RESULTS ---")
    print(f"  Inserted: {inserted}")
    print(f"  Updated:  {updated}")
    print(f"  Deleted:  {deleted}")
    print(f"  Errors:   {errors}")


if __name__ == "__main__":
    main()
