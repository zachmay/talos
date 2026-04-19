#!/usr/bin/env python3
"""Print a tree view of all DB entries by path."""

import json
import subprocess
import sys


def fetch_paths():
    """Fetch all (path, title) pairs from DB via docker psql."""
    sql = (
        "SET app.agent_id = 'default-agent'; "
        "SELECT json_build_object("
        "'path', path, "
        "'title', title, "
        "'source', metadata->'_import'->>'source') "
        "FROM entries;"
    )
    result = subprocess.run(
        ["docker", "compose", "exec", "-T", "db",
         "psql", "-U", "mcp_service", "-d", "talos",
         "-t", "-A", "-c", sql],
        capture_output=True, text=True, check=True,
    )
    entries = []
    for line in result.stdout.strip().split("\n"):
        line = line.strip()
        if not line or line == "SET":
            continue
        try:
            entries.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return entries


def build_tree(entries):
    """Build nested dict: {segment: {'_entries': [titles...], '_children': {...}}}"""
    root = {"_children": {}, "_entries": []}
    for e in entries:
        path = e.get("path") or []
        title = e.get("title") or "(untitled)"
        node = root
        for seg in path:
            if seg not in node["_children"]:
                node["_children"][seg] = {"_children": {}, "_entries": []}
            node = node["_children"][seg]
        node["_entries"].append(title)
    return root


def count_subtree(node):
    """Return total entries in this node and its descendants."""
    total = len(node["_entries"])
    for child in node["_children"].values():
        total += count_subtree(child)
    return total


def print_tree(node, prefix="", is_root=True, is_last=True, name="/", show_titles=False, max_titles=10):
    """Print the tree."""
    total = count_subtree(node)
    direct = len(node["_entries"])
    if direct and total > direct:
        label = f"{name} ({total} total, {direct} direct)"
    else:
        label = f"{name} ({total})"

    if is_root:
        print(label)
        child_prefix = ""
    else:
        connector = "└── " if is_last else "├── "
        print(f"{prefix}{connector}{label}")
        child_prefix = prefix + ("    " if is_last else "│   ")

    if show_titles and node["_entries"]:
        titles = sorted(node["_entries"])
        for t in titles[:max_titles]:
            print(f"{child_prefix}· {t}")
        if len(titles) > max_titles:
            print(f"{child_prefix}· ... and {len(titles) - max_titles} more")

    children = sorted(node["_children"].items(), key=lambda x: x[0].lower())
    for i, (child_name, child_node) in enumerate(children):
        last = i == len(children) - 1
        print_tree(child_node, child_prefix, False, last, child_name, show_titles, max_titles)


def main():
    show_titles = "--titles" in sys.argv
    max_titles = 10
    for arg in sys.argv:
        if arg.startswith("--max-titles="):
            max_titles = int(arg.split("=")[1])

    print("Fetching from DB...")
    entries = fetch_paths()
    print(f"Total entries: {len(entries)}\n")

    tree = build_tree(entries)
    print_tree(tree, show_titles=show_titles, max_titles=max_titles)


if __name__ == "__main__":
    main()
