import { describe, expect, it } from 'vitest'
import {
  mergeParsedModelRows,
  parseModelsFromResponse,
} from '@/services/providers/list-models'

describe('parseModelsFromResponse field mapping', () => {
  it('maps Gateway context, max tokens, per-token pricing, and capability tags', () => {
    const rows = parseModelsFromResponse(
      'gateway',
      JSON.stringify({
        data: [
          {
            id: 'anthropic/claude-opus-5',
            tags: ['reasoning', 'fast', 'vision', 'tool-use'],
            context_window: 200000,
            max_tokens: 64000,
            pricing: {
              input: '0.000015',
              output: '0.000075',
              input_cache_read: '0.0000015',
              input_cache_write: '0.00001875',
            },
          },
        ],
      }),
    )

    expect(rows).toEqual([
      {
        id: 'anthropic/claude-opus-5',
        supportsFast: true,
        contextWindow: 200000,
        maxOutputTokens: 64000,
        pricing: {
          inputPerMillion: 15,
          outputPerMillion: 75,
          cacheReadPerMillion: 1.5,
          cacheWritePerMillion: 18.75,
        },
        vision: true,
        toolCalling: true,
      },
    ])
    expect(rows[0]?.supportsReasoningEffort).toBeUndefined()
  })

  it('skips Gateway tiered pricing arrays', () => {
    const rows = parseModelsFromResponse(
      'gateway',
      JSON.stringify({
        data: [
          {
            id: 'tiered/model',
            context_window: 8192,
            pricing: [
              { input: '0.000001', output: '0.000002' },
              { input: '0.000003', output: '0.000006' },
            ],
          },
        ],
      }),
    )

    expect(rows).toEqual([{ id: 'tiered/model', contextWindow: 8192 }])
  })

  it('maps OpenRouter context, completion cap, pricing, image, and tools', () => {
    const rows = parseModelsFromResponse(
      'openrouter',
      JSON.stringify({
        data: [
          {
            id: 'openai/gpt-4o',
            context_length: 128000,
            top_provider: { max_completion_tokens: 16384 },
            pricing: {
              prompt: '0.0000025',
              completion: '0.00001',
              input_cache_read: '0.00000125',
              input_cache_write: '0.0000025',
            },
            architecture: { input_modalities: ['text', 'image'] },
            supported_parameters: ['temperature', 'tools'],
          },
        ],
      }),
    )

    expect(rows).toEqual([
      {
        id: 'openai/gpt-4o',
        contextWindow: 128000,
        maxOutputTokens: 16384,
        pricing: {
          inputPerMillion: 2.5,
          outputPerMillion: 10,
          cacheReadPerMillion: 1.25,
          cacheWritePerMillion: 2.5,
        },
        vision: true,
        toolCalling: true,
      },
    ])
  })

  it('skips OpenRouter tiered pricing arrays', () => {
    const rows = parseModelsFromResponse(
      'openrouter',
      JSON.stringify({
        data: [
          {
            id: 'openai/gpt-4o',
            context_length: 128000,
            pricing: [{ prompt: '0.0000025', completion: '0.00001' }],
          },
        ],
      }),
    )

    expect(rows).toEqual([{ id: 'openai/gpt-4o', contextWindow: 128000 }])
  })

  it('maps Google token limits without inventing vision', () => {
    const rows = parseModelsFromResponse(
      'google',
      JSON.stringify({
        models: [
          {
            name: 'models/gemini-2.0-flash',
            inputTokenLimit: 1048576,
            outputTokenLimit: 8192,
          },
        ],
      }),
    )

    expect(rows).toEqual([
      {
        id: 'gemini-2.0-flash',
        contextWindow: 1048576,
        maxOutputTokens: 8192,
      },
    ])
    expect(rows[0]?.vision).toBeUndefined()
    expect(rows[0]?.toolCalling).toBeUndefined()
  })

  it('maps generic OpenAI-compatible context fields when present', () => {
    expect(
      parseModelsFromResponse(
        'openai',
        JSON.stringify({ data: [{ id: 'local-a', context_window: 32768 }] }),
      ),
    ).toEqual([{ id: 'local-a', contextWindow: 32768 }])

    expect(
      parseModelsFromResponse(
        'openai',
        JSON.stringify({ data: [{ id: 'local-b', context_length: 65536 }] }),
      ),
    ).toEqual([{ id: 'local-b', contextWindow: 65536 }])

    expect(
      parseModelsFromResponse(
        'openai',
        JSON.stringify({ models: [{ id: 'local-c', max_model_len: 131072 }] }),
      ),
    ).toEqual([{ id: 'local-c', contextWindow: 131072 }])
  })

  it('prefers context_window over context_length and max_model_len', () => {
    const rows = parseModelsFromResponse(
      'openai',
      JSON.stringify({
        data: [
          {
            id: 'local-d',
            context_window: 8192,
            context_length: 4096,
            max_model_len: 2048,
          },
        ],
      }),
    )

    expect(rows).toEqual([{ id: 'local-d', contextWindow: 8192 }])
  })
})

describe('mergeParsedModelRows reported fields', () => {
  it('keeps live numeric fields and ORs capability flags', () => {
    const merged = mergeParsedModelRows(
      {
        id: 'same',
        contextWindow: 1000,
        vision: true,
      },
      {
        id: 'same',
        contextWindow: 8000,
        maxOutputTokens: 512,
        pricing: { inputPerMillion: 1, outputPerMillion: 2 },
        toolCalling: true,
      },
    )

    expect(merged).toEqual({
      id: 'same',
      contextWindow: 8000,
      maxOutputTokens: 512,
      pricing: { inputPerMillion: 1, outputPerMillion: 2 },
      vision: true,
      toolCalling: true,
    })
  })
})
