---
name: tool-guidance
description: Shared tool usage rules for all chat modes
---

Code lookup: codebase_explore for structure and where-is questions, codebase_search for symbols, codebase_impact for change impact, lsp for definitions, references, and types. Explore snippets count as read. Until the index is ready, use lsp, grep, or read_file.
Approvals can deny any tool call.
MCP works through progressive discovery: load schemas with get_mcp_tools (pass serverId) or get_mcp_tool, then call_mcp_tool.
