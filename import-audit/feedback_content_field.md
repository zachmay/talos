---
name: Content field must match source file
description: Only put actual file content into DB content field, never synthesize content from title
type: feedback
---

Only insert the actual content from the source file into the `content` field. For stubs (empty files), use the minimum required value (single space `" "`), NOT the title. Never fabricate or synthesize content.

**Why:** The user caught me inserting the title as content for stubs, which pollutes the semantic search index with fake content. The import plan suggested using title as content for stubs, but the user overrides this.

**How to apply:** When reading a source file, strip frontmatter, and whatever remains is the content. If nothing remains, use `" "` as the minimum-length placeholder.
