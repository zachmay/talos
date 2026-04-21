// ETag computation for entries.
//
// etag = sha256(canonicalJSON({ title, path, content, metadata_minus_import }))
// where canonicalJSON sorts keys deterministically at every nesting level.
//
// Clients read the etag off get/search responses and pass it back as
// `if_match` on update. The server recomputes the current etag inside the
// update transaction; mismatch → PRECONDITION_FAILED. This guarantees the
// client saw the state it's writing over.

import { createHash } from "node:crypto";
import stringify from "json-stable-stringify";

export interface EtagInputs {
  title: string;
  path: string[] | null;
  content: string | null;
  metadata: Record<string, unknown> | null;
}

// Fields in metadata that are Talos-owned provenance, not user-editable.
// Excluded from the etag so an internal reshuffling of _import doesn't
// invalidate a client's held etag.
const METADATA_EXCLUDE = new Set(["_import"]);

function stripInternal(metadata: Record<string, unknown> | null): Record<string, unknown> {
  if (!metadata) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (METADATA_EXCLUDE.has(k)) continue;
    out[k] = v;
  }
  return out;
}

export function computeEtag(input: EtagInputs): string {
  const canonical = stringify({
    title: input.title,
    path: input.path ?? [],
    content: input.content ?? "",
    metadata: stripInternal(input.metadata),
  });
  if (canonical === undefined) {
    throw new Error("canonicalJSON returned undefined");
  }
  return createHash("sha256").update(canonical).digest("hex");
}
