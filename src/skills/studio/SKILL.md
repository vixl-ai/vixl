---
name: studio
description: Publish Comark studio artifacts with write_studio_artifact. Use blocks when they help; prose-only is fine. Never use HTML.
---

# Studio artifacts

Studio publishing rules are auto-injected in studio mode.

Publish durable pages to `.vixl/studio/<slug>/index.md`. Optional `data.json` sidecar for large structured payloads.

## Research

- Use read-only spawn_subagent, browser, MCP, and codebase tools before publishing with write_studio_artifact.
- Subagents spawned in this mode are read-only; the harness rejects capabilities: 'write'.
- For host/ops samples, use run_terminal (approvals apply). Call `load_skill("studio-blocks")` for the sampling pattern.

## Publishing

- Data may come from the user, prior context, trusted MCP tools, or inline YAML in the artifact.
- Publish with **write_studio_artifact** (Comark markdown only, never HTML).
- Prose-only is valid for briefs, summaries, and narrative docs. Add blocks when numbers, charts, or tables improve clarity.
- Call `load_skill("studio-blocks")` for the Comark block catalog and visual quality rules.
