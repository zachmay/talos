---
name: example-skill
description: Demonstrates the skill system by echoing arguments back to the caller
---

# Example Skill

This skill demonstrates the Talos skill system. It echoes its arguments.

## Scripts

### run.js
Echoes the provided arguments back to stdout.

```bash
node /app/agent/skills/example-skill/run.js <message>
```

**Args:** Any text to echo back
**Output:** `[example-skill]: <message>`
