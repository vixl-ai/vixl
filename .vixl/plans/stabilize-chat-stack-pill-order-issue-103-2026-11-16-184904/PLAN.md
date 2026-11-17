---
id: stabilize-chat-stack-pill-order-issue-103-2026-11-16-184904
title: "Stabilize chat stack pill order (issue #103)"
createdAt: 2026-11-17T01:49:04.454Z
mode: plan
sourceChatId: 9e6a1875-e50f-4060-beae-445a2666ef20
sourceChatSlug: vixl
builtAt: 2026-11-17T01:49:24.472Z
lastBuildChatId: 9e6a1875-e50f-4060-beae-445a2666ef20
lastBuildChatSlug: vixl
lastBuildModel: "local::Qwen3.8-Flash-Next-UD-Q4_K_XL"
todos:
  - id: 1
    content: "Rewrite use-chat-stack-pills to canonical fixed pill order"
    status: completed
  - id: 2
    content: "Add spec covering hydration order and open-stack behavior"
    status: completed
  - id: 3
    content: "Run targeted tests then full CI suite"
    status: completed
---

# Stabilize chat stack pill order (issue #103)

Issue: https://github.com/vixl-ai/vixl/issues/103 - "When coming back to a chat terminal, tasks, etc chips shift places".

## Root cause

`src/composables/use-chat-stack-pills.ts` derives pill order from *arrival order*, not a fixed order:

- `order` starts as `[]` at setup. At that moment every count is 0 because the counts hydrate from different async sources: `runningShells` waits on `agentShellRevision >= 0` (shell registry sync), `todos` waits on the chat session paint (`paintedSession.todos`), and `subagents` / `approvals` / `queue` wait on the harness session attaching.
- The counts watcher appends each id to the end of `order` the first time its count goes above 0, so pill order equals whichever source resolves first. That race differs on every visit to the same chat.
- The same watcher also moves a pill to the end whenever its count drops to 0 and later returns.

`visiblePills` just filters that mutable `order`, so `ChatStackPillBar` renders the shifting order.

## Fix

Make the rendered order a pure function of the fixed `STACK_IDS` declaration order. Positions never depend on hydration timing, and a pill that returns re-enters at its own slot instead of the end.

- `visiblePills = computed(() => STACK_IDS.filter((id) => count(id) > 0))`
- Drop the `order` ref and the ordering branch of the counts watcher.
- Keep the existing open-stack behavior: open panel closes when its own count hits 0, an increase in approvals opens the approvals panel, `resetKey` (thread key) change recomputes the default (approvals open when pending approvals exist).

## Files

- `src/composables/use-chat-stack-pills.ts` - canonical order, remove arrival-order state.
- `spec/src/composables/use-chat-stack-pills.test.ts` - new spec: out-of-order hydration keeps canonical order, reappearing pill keeps its slot, open stack closes at zero, approvals auto-open, reset key resets.

## Validation

- `npx vitest run spec/src/composables/use-chat-stack-pills.test.ts spec/src/views/agent-thread-view.test.ts`
- Project CI suite (typecheck, lint, tests) as the final step.