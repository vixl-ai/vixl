---
title: Worktrees
description: A Vixl worktree is a registered git checkout nested under a parent project, with its own branch, chats, and code graph.
---

# Worktrees

A worktree sub-project is a normal [fleet project](/concepts/projects-and-home-chats) with a `worktree` link (`parentId`, `branch`, `managed`). Vixl derives that link from git when you add or open the folder, or when a chat moves onto it.

Vixl-managed worktrees live at `~/.vixl/worktrees/{parentSlug}/{name}` (on Windows, `%USERPROFILE%\.vixl\worktrees\{parentSlug}\{name}`) on branch `vixl/<name>`. `name` is a lowercase slug (`a-z`, `0-9`, hyphen).

The home pseudo-project cannot host worktrees.

## Ask the agent to create one

In [Agent](/concepts/chat-modes) or Orchestrator, ask for a worktree, then the work: for example, "create a worktree, then implement the auth todos there." The parent calls `worktree_create`. Nested sub-agents cannot.

Vixl always asks first (`Create worktree vixl/<name>?`). After you approve, it:

1. Creates the git worktree and branch (optional `baseRef`, default `HEAD`).
2. Copies the parent's `.vixl/plans/` into the new checkout (plans only; existing files in the checkout are not overwritten).
3. Registers it as a fleet project.
4. Starts a [code graph](/concepts/code-graphs) for that root.

`worktree_create` does not move the current chat. The new row appears nested under the parent in the sidebar, with the branch name and a dirty indicator. The worktree project page shows a **Worktree of {parent} on {branch}** banner. That row has its own chat list.

To continue this chat inside the worktree, the agent follows with `move_workspace` (another approval). If this chat has an active plan, that plan directory is copied to the new root at the same relative path, and an open plan tab follows. To keep this chat on the parent and run an isolated implementer, it passes the new slug as `workspaceSlug` to `spawn_subagent`. You can also open the nested row and start a chat there yourself.

## Several worktrees on one project

One parent can have many worktree children. Each child is its own project: its own slug, chats, graph, and checkout. They nest under that parent in the sidebar.

## Parallel implementers

[Orchestrator](/using/orchestrate-sub-agents) creates one worktree per implementer, then spawns with that `workspaceSlug`. The parent stays on the original checkout. Workers do not share a working tree.

`workspaceSlug` must be a worktree child of the current project, or a member of the current group. Read-only and write sub-agents are both allowed. Do not use `move_workspace` just to place an implementer.

The [plan Orchestrate](/using/work-with-plans) handoff uses this same pattern.

## Adopt a worktree you created in the shell

A checkout from `git worktree add` in the shell is adopted when you [add or open that folder](/getting-started/add-a-project), or when a chat moves onto it. The link is `managed: false`. The branch is whatever git reports. It still nests under the registered parent if that main checkout is in the fleet.

## Remove a worktree

`worktree_remove` is Agent-only (not Orchestrator), always user-approved, and cannot run on a nested sub-agent. It cannot remove the current chat's workspace: pass a different `rootPath`. It refuses while any chat is running on that slug.

The approval shows branch, dirty (yes, no, or unknown), and chat count. A dirty checkout needs `force`. After you approve, Vixl runs `git worktree remove` and unregisters the fleet row.

The nested sidebar row also has **Remove worktree**, which is that same removal, not **Remove from sidebar**.

## Merge back

There is no merge or apply button. Bring the branch back with git tools on the parent (the agent can do that if you ask), or open a pull request yourself.

## Plans

[Plans](/using/work-with-plans) travel with the worktree so the same `PLAN.md` stays the source of truth.

`worktree_create` copies the parent's `.vixl/plans/` directory into the new checkout. That copy is plans only. Existing files in the checkout are not overwritten, and there is no `.worktreeinclude` list for other gitignored files.

`move_workspace` copies the chat's active plan directory to the new root at the same relative path. An open plan tab in the workbench follows that root, so the plan doc keeps updating live while the chat runs in the worktree.

## Code graphs

Each worktree has its own code graph, keyed by that checkout's root path. Code on `vixl/<name>` can diverge from the parent, so the index is not shared. See [Code graphs](/concepts/code-graphs).

## Groups

[Project groups](/getting-started/create-a-project-group) are unchanged. A worktree project can be a group member like any other registered folder. `spawn_subagent` can target a group member with `workspaceSlug` the same way it targets a worktree child.

## Not in v1

- No auto-cleanup of unused worktrees
- No merge or apply button in the UI
- No `.worktreeinclude` copy list when creating a checkout
- No worktrees for the home pseudo-project

Next, [orchestrate sub-agents](/using/orchestrate-sub-agents), or [add a project](/getting-started/add-a-project).
