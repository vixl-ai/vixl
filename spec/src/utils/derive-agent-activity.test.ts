import { describe, expect, it } from 'vitest'
import type { AgentTurn } from '@/types/chat/agent-turn'
import type { SubagentTimelineItem } from '@/types/chat/chat-timeline-item'
import deriveAgentActivity from '@/utils/derive-agent-activity'

const turn = (partial: Partial<AgentTurn> & { id?: string }): AgentTurn => ({
  id: partial.id ?? 'turn-1',
  steps: partial.steps ?? [],
  text: partial.text ?? '',
  error: partial.error,
})

const subagent = (
  partial: Partial<SubagentTimelineItem> & { subagentId: string; name: string },
): SubagentTimelineItem => ({
  type: 'subagent',
  subagentId: partial.subagentId,
  name: partial.name,
  blocking: partial.blocking ?? true,
  status: partial.status ?? 'running',
  tools: partial.tools ?? [],
  compactions: partial.compactions ?? [],
  toolCallId: partial.toolCallId,
  summary: partial.summary,
  prompt: partial.prompt,
  model: partial.model,
})

describe('deriveAgentActivity', () => {
  it('returns null when idle with nothing running', () => {
    expect(
      deriveAgentActivity({
        status: 'ready',
        turn: turn({}),
        runningSubagents: [],
      }),
    ).toBeNull()
  })

  it('prefers pending approval', () => {
    expect(
      deriveAgentActivity({
        status: 'streaming',
        turn: turn({}),
        runningSubagents: [
          subagent({ subagentId: 's1', name: 'Reading auth', blocking: true }),
        ],
        hasPendingApproval: true,
      }),
    ).toBe('Waiting for approval')
  })

  it('waits for MCP authentication', () => {
    expect(
      deriveAgentActivity({
        status: 'streaming',
        turn: turn({}),
        runningSubagents: [],
        hasPendingMcpAuth: true,
      }),
    ).toBe('Waiting for MCP authentication')
  })

  it('waits for a blocking subagent', () => {
    expect(
      deriveAgentActivity({
        status: 'streaming',
        turn: turn({
          steps: [
            {
              id: 'step-1',
              text: '',
              reasoning: '',
              tools: [
                {
                  toolCallId: 't1',
                  name: 'spawn_subagent',
                  status: 'running',
                  args: { agentName: 'Reading auth' },
                },
              ],
            },
          ],
        }),
        runningSubagents: [
          subagent({
            subagentId: 's1',
            name: 'Reading auth',
            blocking: true,
            toolCallId: 't1',
          }),
        ],
      }),
    ).toBe('Waiting for Reading auth')
  })

  it('hides sticky activity while a parent tool is running', () => {
    expect(
      deriveAgentActivity({
        status: 'streaming',
        turn: turn({
          steps: [
            {
              id: 'step-1',
              text: '',
              reasoning: '',
              tools: [
                {
                  toolCallId: 't1',
                  name: 'edit_file',
                  status: 'running',
                  args: { path: 'src/a.ts' },
                },
              ],
            },
          ],
        }),
        runningSubagents: [
          subagent({
            subagentId: 's1',
            name: 'Scanning permissions',
            blocking: false,
          }),
        ],
      }),
    ).toBeNull()
  })

  it('waits for background subagents when parent is ready', () => {
    expect(
      deriveAgentActivity({
        status: 'ready',
        turn: turn({
          steps: [
            {
              id: 'step-1',
              text: 'Done spawning.',
              reasoning: '',
              tools: [
                {
                  toolCallId: 't1',
                  name: 'spawn_subagent',
                  status: 'done',
                  args: { agentName: 'Scanning permissions' },
                  result: { subagentId: 's1', status: 'running' },
                },
              ],
            },
          ],
        }),
        runningSubagents: [
          subagent({
            subagentId: 's1',
            name: 'Scanning permissions',
            blocking: false,
          }),
        ],
      }),
    ).toBe('Waiting for Scanning permissions')
  })

  it('hides sticky activity while create_plan is running', () => {
    expect(
      deriveAgentActivity({
        status: 'streaming',
        turn: turn({
          steps: [
            {
              id: 'step-1',
              text: '',
              reasoning: '',
              tools: [
                {
                  toolCallId: 't1',
                  name: 'create_plan',
                  status: 'running',
                  args: { title: 'Ship it' },
                },
              ],
            },
          ],
        }),
        runningSubagents: [],
      }),
    ).toBeNull()
  })

  it('shows Working before first content', () => {
    expect(
      deriveAgentActivity({
        status: 'submitted',
        turn: turn({}),
        runningSubagents: [],
      }),
    ).toBe('Working')
  })

  it('shows Processing request after last-step tools finish', () => {
    expect(
      deriveAgentActivity({
        status: 'streaming',
        turn: turn({
          steps: [
            {
              id: 'step-1',
              text: '',
              reasoning: '',
              tools: [
                {
                  toolCallId: 't0',
                  name: 'read_file',
                  status: 'done',
                  args: { path: 'a.ts' },
                },
              ],
            },
          ],
        }),
        runningSubagents: [],
      }),
    ).toBe('Processing request')
  })

  it('shows Processing request after last-step tools finish with preamble', () => {
    expect(
      deriveAgentActivity({
        status: 'streaming',
        turn: turn({
          steps: [
            {
              id: 'step-1',
              text: 'Let me check that file.',
              reasoning: 'Need the current contents.',
              tools: [
                {
                  toolCallId: 't0',
                  name: 'read_file',
                  status: 'done',
                  args: { path: 'a.ts' },
                },
              ],
            },
          ],
        }),
        runningSubagents: [],
      }),
    ).toBe('Processing request')
  })

  it('shows Processing request on an empty next step after done tools', () => {
    expect(
      deriveAgentActivity({
        status: 'streaming',
        turn: turn({
          steps: [
            {
              id: 'step-1',
              text: '',
              reasoning: '',
              tools: [
                {
                  toolCallId: 't0',
                  name: 'read_file',
                  status: 'done',
                  args: { path: 'a.ts' },
                },
              ],
            },
            {
              id: 'step-2',
              text: '',
              reasoning: '',
              tools: [],
            },
          ],
        }),
        runningSubagents: [],
      }),
    ).toBe('Processing request')
  })

  it('hides sticky activity while streaming text with no completed-tool wait', () => {
    expect(
      deriveAgentActivity({
        status: 'streaming',
        turn: turn({
          steps: [
            {
              id: 'step-1',
              text: 'The backend manages a',
              reasoning: '',
              tools: [],
            },
          ],
        }),
        runningSubagents: [],
      }),
    ).toBeNull()
  })

  it('hides Working and Processing request while compacting', () => {
    expect(
      deriveAgentActivity({
        status: 'streaming',
        turn: turn({
          steps: [
            {
              id: 'step-1',
              text: '',
              reasoning: '',
              tools: [
                {
                  toolCallId: 't0',
                  name: 'read_file',
                  status: 'done',
                  args: { path: 'a.ts' },
                },
              ],
            },
          ],
        }),
        runningSubagents: [],
        compacting: true,
      }),
    ).toBeNull()

    expect(
      deriveAgentActivity({
        status: 'submitted',
        turn: turn({}),
        runningSubagents: [],
        compacting: true,
      }),
    ).toBeNull()
  })

  it('still prefers pending approval while compacting', () => {
    expect(
      deriveAgentActivity({
        status: 'streaming',
        turn: turn({}),
        runningSubagents: [],
        hasPendingApproval: true,
        compacting: true,
      }),
    ).toBe('Waiting for approval')
  })

  it('hides sticky activity once reasoning is visible', () => {
    expect(
      deriveAgentActivity({
        status: 'streaming',
        turn: turn({
          steps: [
            {
              id: 'step-1',
              text: '',
              reasoning: 'Considering the request…',
              tools: [],
            },
          ],
        }),
        runningSubagents: [],
      }),
    ).toBeNull()
  })

  it('shows Starting while spawn is running before subagent-start', () => {
    expect(
      deriveAgentActivity({
        status: 'streaming',
        turn: turn({
          steps: [
            {
              id: 'step-1',
              text: '',
              reasoning: '',
              tools: [
                {
                  toolCallId: 't1',
                  name: 'spawn_subagent',
                  status: 'running',
                  args: { agentName: 'Reading auth' },
                },
              ],
            },
          ],
        }),
        runningSubagents: [],
      }),
    ).toBe('Starting Reading auth…')
  })
})
