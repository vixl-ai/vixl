import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import buildTimelineTranscript from '@/services/harness/compact/build-timeline-transcript'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'

const userMessage = (id: string, text: string): UIMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text }],
})

describe('buildTimelineTranscript', () => {
  it('includes tool name, args, and result and preserves order', () => {
    const timeline: ChatTimelineItem[] = [
      {
        type: 'user',
        message: userMessage('u1', 'please read config'),
      },
      {
        type: 'agent-turn',
        turn: {
          id: 'a1',
          text: 'config looks good',
          steps: [
            {
              id: 's1',
              text: 'opening the file',
              reasoning: 'need the file contents',
              tools: [
                {
                  toolCallId: 't1',
                  name: 'read_file',
                  status: 'done',
                  args: { path: '/tmp/config.json' },
                  result: { content: 'listen: 443' },
                },
              ],
            },
          ],
        },
      },
    ]

    const transcript = buildTimelineTranscript(timeline)

    expect(transcript).toContain('please read config')
    expect(transcript).toContain('read_file')
    expect(transcript).toContain('/tmp/config.json')
    expect(transcript).toContain('listen: 443')
    expect(transcript).toContain('config looks good')

    const userAt = transcript.indexOf('please read config')
    const toolAt = transcript.indexOf('read_file')
    const resultAt = transcript.indexOf('listen: 443')
    const replyAt = transcript.indexOf('config looks good')
    expect(userAt).toBeGreaterThanOrEqual(0)
    expect(toolAt).toBeGreaterThan(userAt)
    expect(resultAt).toBeGreaterThan(toolAt)
    expect(replyAt).toBeGreaterThan(resultAt)
  })

  it('returns empty string when the timeline has no compactable content', () => {
    expect(buildTimelineTranscript([])).toBe('')
  })
})
