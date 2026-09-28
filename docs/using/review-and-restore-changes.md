---
title: Review and restore changes
description: Review Vixl git diffs in the workbench Changes tab, or restore files from a per-turn checkpoint on an agent message.
---

# Review and restore changes

Two surfaces show what changed: the workbench Changes tab ([git](https://git-scm.com) working tree) and the per-turn file list on an agent message (Vixl file checkpoints). They are not the same thing.

## Git Changes tab

Open the workbench plus menu and choose Changes. Changes needs an active [project](/concepts/projects-and-home-chats) with a git repository.

The tab lists Local and the current branch (`git branch --show-current`). Ignored files are hidden. Search filters paths (placeholder Search changes). Click a row to open a read-only side-by-side [Monaco](https://microsoft.github.io/monaco-editor/) diff. The tab refreshes when it is focused and when git HEAD changes.

Status letters on rows and in the file tree: Added, Untracked, Modified, Deleted, Renamed, Conflicted.

The chat input also has a git branch picker when the workspace is a git repo. That checkout is yours. See [Use the workbench](/using/use-the-workbench).

## Restore files from a turn

After an agent turn that mutated files, the thread shows a count such as 3 files changed. Expand it for paths. Restore files asks Revert files from this turn?. Confirm with Revert files.

That rolls those paths back to the checkpoint taken before the turn (created files are removed) and discards the conversation after the preceding user message. Manual edits on those paths are overwritten too.

Restore is disabled on a live turn and on a read-only subagent thread.

## Keep or revert when you edit a send

If you edit a user message (or retry) after later file mutations, a policy dialog asks Keep files or Revert files. Title examples: Submit edited message?. Keep files leaves disk unchanged. Revert files rolls those paths back. Either way, the conversation after that point is discarded.

## Git neutrality

Vixl has git tools (`git_status`, `git_diff`, `git_log`, `git_branch`, and in Agent mode `git_checkout`, `git_branch_create`, `git_commit`). Built-in prompts never tell the agent to commit, create a branch, or follow a git flow. Agent mode's skill says: Do not commit unless the user asks. `git_commit` runs `git commit -m` with the message you (or the agent, if you asked) supplied. It does not add a Co-authored-by trailer for Vixl or the model. If the model is a tool it was not a co-author, and the harness is not either.

`git_diff` accepts optional `path`, `staged` (index vs HEAD when `base` is omitted), and `base` (a ref or range such as `HEAD` for all uncommitted changes, or `main...HEAD` for the whole branch). With no arguments it shows unstaged changes only, and diffs never include untracked files.

[Use the workbench](/using/use-the-workbench)
