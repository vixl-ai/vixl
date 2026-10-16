import type { GitRepoInfo } from '@/types/git/git-repo-info'

export const NOT_A_GIT_REPOSITORY = 'Not a git repository'

export const notAGitRepoResult = (): GitRepoInfo => ({
  isRepo: false,
  currentBranch: null,
})

const rejectionMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

export const isNotAGitRepositoryError = (error: unknown): boolean =>
  rejectionMessage(error).includes(NOT_A_GIT_REPOSITORY)

export const withGitRepoGuard = async <T>(
  run: () => Promise<T>,
): Promise<T | GitRepoInfo> => {
  try {
    return await run()
  } catch (error) {
    if (isNotAGitRepositoryError(error)) {
      return notAGitRepoResult()
    }
    throw error
  }
}
