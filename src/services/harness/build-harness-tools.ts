import { readFile, listDir, grep, globFiles } from '@/services/harness/read'
import {
  writeFile,
  updateTodos,
  writeStudioArtifact,
  deleteFile,
  moveFile,
} from '@/services/harness/write'
import { editFile, applyPatch } from '@/services/harness/edit'
import {
  gitStatus,
  gitDiff,
  gitLog,
  gitBranch,
  gitCheckout,
  gitBranchCreate,
  gitCommit,
} from '@/services/harness/git'
import {
  callMcpTool,
  getMcpTools,
  getMcpPrompt,
  listMcpResources,
  readMcpResource,
} from '@/services/harness/mcp'
import {
  codebaseSearch,
  codebaseExplore,
  codebaseImpact,
  codebaseStatus,
} from '@/services/harness/codebase'
import { runTerminal, terminalOutput, stopTerminal } from '@/services/harness/shell'
import { createPlanTool, updatePlanTodo } from '@/services/harness/plan'
import { askUser } from '@/services/harness/ask'
import { loadSkillTool } from '@/services/harness/skill'
import { lspQuery, diagnostics } from '@/services/harness/lsp'
import { webFetchTool } from '@/services/harness/web'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const buildHarnessTools = (ctx: HarnessToolContext) => ({
  read_file: readFile(ctx),
  list_dir: listDir(ctx),
  grep: grep(ctx),
  glob_files: globFiles(ctx),
  codebase_explore: codebaseExplore(ctx),
  codebase_search: codebaseSearch(ctx),
  codebase_impact: codebaseImpact(ctx),
  codebase_status: codebaseStatus(ctx),
  git_status: gitStatus(ctx),
  git_diff: gitDiff(ctx),
  git_log: gitLog(ctx),
  git_branch: gitBranch(ctx),
  git_checkout: gitCheckout(ctx),
  git_branch_create: gitBranchCreate(ctx),
  git_commit: gitCommit(ctx),
  delete_file: deleteFile(ctx),
  move_file: moveFile(ctx),
  write_file: writeFile(ctx),
  edit_file: editFile(ctx),
  apply_patch: applyPatch(ctx),
  call_mcp_tool: callMcpTool(ctx),
  get_mcp_tools: getMcpTools(ctx),
  list_mcp_resources: listMcpResources(ctx),
  read_mcp_resource: readMcpResource(ctx),
  get_mcp_prompt: getMcpPrompt(ctx),
  ask_user: askUser(ctx),
  load_skill: loadSkillTool(ctx),
  create_plan: createPlanTool(ctx),
  update_plan_todo: updatePlanTodo(ctx),
  update_todos: updateTodos(),
  write_studio_artifact: writeStudioArtifact(ctx),
  run_terminal: runTerminal(ctx),
  terminal_output: terminalOutput(),
  stop_terminal: stopTerminal(),
  lsp: lspQuery(),
  diagnostics: diagnostics(),
  web_fetch: webFetchTool(ctx),
})

export default buildHarnessTools
