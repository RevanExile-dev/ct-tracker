---
name: ct-security
description: Use automatically for CT Tracker authentication, secrets, permissions, public/private exposure, GitHub Actions permissions, agent/MCP configuration, deployment security, or any change that could expose credentials or grant automation broader write access.
---

# CT Tracker security domain

- Inspect first; do not auto-fix broad security findings without understanding impact.
- Never print, commit, copy into prompts, or expose secret values. Refer to secret names only.
- Prefer least-privilege GitHub Actions permissions and read-only access where writes are unnecessary.
- Treat hooks, MCP configuration, agent instructions, workflow scripts, and package-install commands as executable/trusted-boundary configuration.
- For public repository changes, assume committed files are permanently public even if later deleted.
- Do not weaken existing permission or verification gates merely to make automation smoother.
- Separate a security observation from a proven vulnerability; report evidence and uncertainty precisely.
