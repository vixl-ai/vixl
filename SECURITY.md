# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| latest on `main` | Yes |
| older commits / tags | No |

Vixl is pre-1.0. Only the current `main` branch is supported for security fixes.

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report security issues privately via [GitHub Security Advisories](https://github.com/vixl-ai/vixl/security/advisories/new) (preferred) or by emailing the repository owner through their GitHub profile contact options.

Include:

- A description of the issue and its impact
- Steps to reproduce or a proof of concept
- Affected versions and configuration (OS, Vixl build, providers/MCP servers involved, etc.)

You can expect an initial response within a reasonable timeframe. We will work with you on a fix and coordinated disclosure when appropriate.

## Scope

This policy covers the **vixl** application (Vue frontend, Tauri shell, agent harness, and first-party tools). Issues in downstream dependencies (Tauri, AI SDK providers, MCP servers, OS keychain, and similar) should be reported to those projects when they are the root cause.

Vixl can run shell commands and edit files under user policy. Treat local agent permissions as best-effort. Reports about sandbox escape, secret leakage, or unintended tool execution are in scope.
