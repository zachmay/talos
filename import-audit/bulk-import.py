#!/usr/bin/env python3
"""Bulk import entries into Talos via MCP HTTP API."""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

AUDIT = Path(__file__).parent
REPO = AUDIT.parent
MCP_URL = os.environ.get("TALOS_MCP_URL", "http://localhost:3001/mcp")


def _load_api_key() -> str:
    """Return a bearer token for MCP.

    Precedence: TALOS_API_KEY env var, then the first key found in
    secrets/agent_keys.json (the canonical server-side key registry).
    Raises SystemExit with a helpful message if neither is available.
    """
    env = os.environ.get("TALOS_API_KEY")
    if env:
        return env.strip()
    keys_file = REPO / "secrets" / "agent_keys.json"
    if keys_file.exists():
        try:
            keys = json.loads(keys_file.read_text())
            if isinstance(keys, dict) and keys:
                return next(iter(keys))
        except (OSError, json.JSONDecodeError) as err:
            raise SystemExit(f"Could not read {keys_file}: {err}") from err
    raise SystemExit(
        "No MCP bearer available. Set TALOS_API_KEY or populate secrets/agent_keys.json."
    )


API_KEY = _load_api_key()
GUID_INDEX = AUDIT / "title-guid-index.json"
MANIFEST = AUDIT / "roam-manifest.json"

# --- MCP JSON-RPC helpers ---

def mcp_request(method, params, session_id=None, req_id=1):
    """Send a JSON-RPC request to the MCP server."""
    body = {
        "jsonrpc": "2.0",
        "id": req_id,
        "method": method,
        "params": params,
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}",
        "Accept": "application/json, text/event-stream",
    }
    if session_id:
        headers["mcp-session-id"] = session_id

    req = urllib.request.Request(
        MCP_URL,
        data=json.dumps(body).encode(),
        headers=headers,
        method="POST",
    )

    resp = urllib.request.urlopen(req)
    content_type = resp.headers.get("Content-Type", "")
    raw = resp.read().decode()

    # Handle SSE responses
    if "text/event-stream" in content_type:
        session = resp.headers.get("mcp-session-id")
        results = []
        for line in raw.split("\n"):
            if line.startswith("data: "):
                try:
                    results.append(json.loads(line[6:]))
                except json.JSONDecodeError:
                    pass
        return results, session
    else:
        return [json.loads(raw)], resp.headers.get("mcp-session-id")


def init_session():
    """Initialize MCP session."""
    results, session_id = mcp_request("initialize", {
        "protocolVersion": "2025-03-26",
        "capabilities": {},
        "clientInfo": {"name": "bulk-import", "version": "1.0"},
    })
    print(f"Session: {session_id}")
    return session_id


def call_tool(session_id, tool_name, arguments, req_id=1):
    """Call an MCP tool."""
    results, _ = mcp_request("tools/call", {
        "name": tool_name,
        "arguments": arguments,
    }, session_id=session_id, req_id=req_id)
    return results


def insert_entry(session_id, entry, req_id=1):
    """Insert a single entry and return the GUID."""
    args = {
        "content": entry["content"],
        "title": entry["title"],
        "type": entry["type"],
        "mime_type": entry.get("mime_type", "text/markdown"),
        "path": entry["path"],
        "metadata": entry.get("metadata", {}),
        "verbose": True,
    }

    results = call_tool(session_id, "insert", args, req_id=req_id)

    # Parse result to get ID
    for r in results:
        if "result" in r:
            content = r["result"].get("content", [])
            for c in content:
                if c.get("type") == "text":
                    data = json.loads(c["text"])
                    return data.get("id")
    return None


def get_dedup_key(entry):
    """Get unique key for deduplication. Prefer _import.original, fall back to title."""
    meta = entry.get("metadata", {})
    imp = meta.get("_import", {})
    if imp.get("original"):
        return imp["original"]
    # Back-compat: old manifests used top-level 'original-source'
    if "original-source" in entry:
        return entry["original-source"]
    return entry["title"]


def main():
    # Determine manifest file
    manifest_file = MANIFEST
    args = sys.argv[1:]
    if args and args[0] == "--manifest":
        manifest_file = Path(args[1])
        args = args[2:]

    with open(manifest_file) as f:
        manifest = json.load(f)

    # Load existing GUID index
    if GUID_INDEX.exists():
        with open(GUID_INDEX) as f:
            guid_index = json.load(f)
    else:
        guid_index = {}

    # Filter by path if specified
    filter_path = None
    start_idx = 0
    if args:
        filter_path = args[0]
    if len(args) > 1:
        start_idx = int(args[1])

    if filter_path:
        entries = [e for e in manifest if "/".join(e["path"]) == filter_path]
    else:
        entries = manifest

    # Skip already imported (by original-source key)
    entries_to_import = []
    for e in entries:
        if get_dedup_key(e) not in guid_index:
            entries_to_import.append(e)

    print(f"Total in manifest: {len(entries)}")
    print(f"Already imported: {len(entries) - len(entries_to_import)}")
    print(f"To import: {len(entries_to_import)}")

    if not entries_to_import:
        print("Nothing to import!")
        return

    # Apply start index
    entries_to_import = entries_to_import[start_idx:]
    print(f"Starting from index {start_idx}, importing {len(entries_to_import)} entries")

    # Initialize session
    session_id = init_session()

    # Import entries
    success = 0
    errors = 0
    for i, entry in enumerate(entries_to_import):
        try:
            guid = insert_entry(session_id, entry, req_id=i+1)
            if guid:
                guid_index[get_dedup_key(entry)] = guid
                success += 1
                # Save index every 50 entries
                if success % 50 == 0:
                    with open(GUID_INDEX, "w") as f:
                        json.dump(guid_index, f, indent=2)
                    print(f"  [{success}/{len(entries_to_import)}] saved checkpoint")
            else:
                print(f"  WARN: no GUID returned for '{entry['title']}'")
                errors += 1
        except Exception as e:
            print(f"  ERROR on '{entry['title']}': {e}")
            errors += 1
            # Re-init session on error
            try:
                session_id = init_session()
            except:
                print("  Failed to re-init session, waiting 5s...")
                time.sleep(5)
                session_id = init_session()

        # Progress every 100
        if (i + 1) % 100 == 0:
            print(f"Progress: {i+1}/{len(entries_to_import)} (ok={success}, err={errors})")

    # Final save
    with open(GUID_INDEX, "w") as f:
        json.dump(guid_index, f, indent=2)

    print(f"\nDone! Imported {success}, errors {errors}")
    print(f"GUID index has {len(guid_index)} entries total")


if __name__ == "__main__":
    main()
