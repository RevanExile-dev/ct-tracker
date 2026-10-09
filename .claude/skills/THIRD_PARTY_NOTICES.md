# Third-party skills vendored in this directory

Each skill below is a verbatim copy (plus the local notes listed in
`docs/skill_di_terzi.md`) of work by its authors and stays under the license
named here, NOT under the repository's own license. License texts are copied
next to each skill when the upstream repo provides one.

| Skills | Source | License |
|---|---|---|
| `frontend-design` | https://github.com/anthropics/skills (commit 683bc88) | Apache-2.0 (`LICENSE.txt` in the folder) |
| `neon-postgres-egress-optimizer`, `neon-postgres-branches` | https://github.com/neondatabase/agent-skills (commit bfd013c) | Apache-2.0 (`LICENSE` in each folder) |
| `web-quality-audit`, `performance`, `core-web-vitals`, `accessibility`, `seo`, `best-practices` | https://github.com/addyosmani/web-quality-skills (commit afa8da9), copyright (c) 2026 Addy Osmani | MIT (`LICENSE` in each folder) |

Not vendored on purpose: `vercel-react-best-practices` (the upstream repo ships no license file or copyright notice, only a license field in the skill's frontmatter, so the terms are not clear enough).

Local changes: `neon-postgres-egress-optimizer` and `neon-postgres-branches` have a "ct-tracker note" block added after the frontmatter (Apache-2.0 section 4 change notice); everything else is unmodified.
