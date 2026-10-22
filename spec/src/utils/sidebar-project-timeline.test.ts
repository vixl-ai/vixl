import { describe, expect, it } from 'vitest'
import type { FleetSidebarChat } from '@/types/fleet/fleet-sidebar-chat'
import type { FleetSidebarProject } from '@/types/fleet/fleet-sidebar-project'
import buildSidebarProjectTimeline from '@/utils/sidebar-project-timeline'

const chat = (
  id: string,
  updatedAt?: string,
  pinned = false,
): FleetSidebarChat => ({
  id,
  title: id,
  updatedAt,
  pinned,
})

const worktree = (
  slug: string,
  activityAt?: string,
  chats: FleetSidebarChat[] = [],
): FleetSidebarProject => ({
  slug,
  displayName: slug,
  chats,
  activityAt,
})

describe('sidebar-project-timeline', () => {
  it('places a recent worktree between two parent chats', () => {
    const newer = chat('newer', '2026-01-10T00:00:00.000Z')
    const older = chat('older', '2026-01-01T00:00:00.000Z')
    const nested = chat('nested', '2026-01-05T00:00:00.000Z')
    const wt = worktree('wt', '2026-01-05T00:00:00.000Z', [nested])

    expect(buildSidebarProjectTimeline([newer, older], [wt])).toEqual([
      { kind: 'chat', chat: newer },
      { kind: 'worktree', project: wt },
      { kind: 'chat', chat: older },
    ])
  })

  it('places an older worktree at the bottom', () => {
    const newer = chat('newer', '2026-01-10T00:00:00.000Z')
    const older = chat('older', '2026-01-05T00:00:00.000Z')
    const wt = worktree('wt', '2026-01-01T00:00:00.000Z')

    expect(buildSidebarProjectTimeline([newer, older], [wt])).toEqual([
      { kind: 'chat', chat: newer },
      { kind: 'chat', chat: older },
      { kind: 'worktree', project: wt },
    ])
  })

  it('places an empty worktree by activityAt', () => {
    const newer = chat('newer', '2026-01-10T00:00:00.000Z')
    const older = chat('older', '2026-01-02T00:00:00.000Z')
    const wt = worktree('empty', '2026-01-07T00:00:00.000Z', [])

    expect(buildSidebarProjectTimeline([newer, older], [wt])).toEqual([
      { kind: 'chat', chat: newer },
      { kind: 'worktree', project: wt },
      { kind: 'chat', chat: older },
    ])
  })

  it('keeps pinned chats above a newer worktree', () => {
    const pinned = chat('pinned', '2026-01-01T00:00:00.000Z', true)
    const unpinned = chat('unpinned', '2026-01-05T00:00:00.000Z')
    const wt = worktree('wt', '2026-01-10T00:00:00.000Z')

    expect(buildSidebarProjectTimeline([pinned, unpinned], [wt])).toEqual([
      { kind: 'chat', chat: pinned },
      { kind: 'worktree', project: wt },
      { kind: 'chat', chat: unpinned },
    ])
  })

  it('keeps the chat above the worktree on a timestamp tie', () => {
    const newer = chat('newer', '2026-01-10T00:00:00.000Z')
    const tied = chat('tied', '2026-01-08T00:00:00.000Z')
    const wt = worktree('wt', '2026-01-08T00:00:00.000Z')

    expect(buildSidebarProjectTimeline([newer, tied], [wt])).toEqual([
      { kind: 'chat', chat: newer },
      { kind: 'chat', chat: tied },
      { kind: 'worktree', project: wt },
    ])
  })

  it('interleaves worktrees newest first', () => {
    const newer = chat('newer', '2026-01-10T00:00:00.000Z')
    const older = chat('older', '2026-01-06T00:00:00.000Z')
    const olderWt = worktree('older-wt', '2026-01-02T00:00:00.000Z')
    const newerWt = worktree('newer-wt', '2026-01-08T00:00:00.000Z')

    expect(
      buildSidebarProjectTimeline([newer, older], [olderWt, newerWt]),
    ).toEqual([
      { kind: 'chat', chat: newer },
      { kind: 'worktree', project: newerWt },
      { kind: 'chat', chat: older },
      { kind: 'worktree', project: olderWt },
    ])
  })
})
