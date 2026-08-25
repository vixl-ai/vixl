import * as monaco from 'monaco-editor'

export const WORKING_FILE_SCHEME = 'vixl-file'
export const GIT_HEAD_SCHEME = 'vixl-git-head'

export const workingFileUri = (projectId: string, path: string): monaco.Uri =>
  monaco.Uri.parse(
    `${WORKING_FILE_SCHEME}:///${encodeURIComponent(projectId)}/${encodeURIComponent(path)}`,
  )

export const gitHeadUri = (projectId: string, path: string): monaco.Uri =>
  monaco.Uri.parse(
    `${GIT_HEAD_SCHEME}:///${encodeURIComponent(projectId)}/${encodeURIComponent(path)}`,
  )

export const isGitHeadModel = (model: monaco.editor.ITextModel): boolean =>
  model.uri.scheme === GIT_HEAD_SCHEME
