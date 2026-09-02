import { describe, expect, it } from 'vitest'
import type { LanguageModelUsage } from 'ai'
import readLanguageModelUsageTokens from '@/services/billing/read-language-model-usage-tokens'

describe('readLanguageModelUsageTokens', () => {
  it('prefers flattened inputTokens and outputTokens when they are finite and greater than 0', () => {
    const usage: LanguageModelUsage = {
      inputTokens: 100,
      inputTokenDetails: {
        noCacheTokens: 80,
        cacheReadTokens: 15,
        cacheWriteTokens: 5,
      },
      outputTokens: 50,
      outputTokenDetails: {
        textTokens: 40,
        reasoningTokens: 10,
      },
      totalTokens: 150,
      raw: { prompt_tokens: 999, completion_tokens: 888 },
    }

    expect(readLanguageModelUsageTokens(usage)).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 15,
      cacheWriteTokens: 5,
    })
  })

  it('uses inputTokenDetails and outputTokenDetails when flattened totals are absent', () => {
    expect(
      readLanguageModelUsageTokens({
        inputTokenDetails: {
          noCacheTokens: 80,
          cacheReadTokens: 15,
          cacheWriteTokens: 5,
        },
        outputTokenDetails: {
          textTokens: 40,
          reasoningTokens: 10,
        },
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 15,
      cacheWriteTokens: 5,
    })
  })

  it('reads leaked nested V3 inputTokens.total without treating the object as a count', () => {
    const usage = {
      inputTokens: {
        total: 1100,
        noCache: 1000,
        cacheRead: 50,
        cacheWrite: 50,
      },
      outputTokens: {
        total: 200,
        text: undefined,
        reasoning: undefined,
      },
      raw: { prompt_tokens: 1, completion_tokens: 1 },
    }

    expect(readLanguageModelUsageTokens(usage)).toEqual({
      inputTokens: 1100,
      outputTokens: 200,
      cacheReadTokens: 50,
      cacheWriteTokens: 50,
    })
  })

  it('reads OpenAI raw-only prompt_tokens and completion_tokens', () => {
    expect(
      readLanguageModelUsageTokens({
        raw: {
          prompt_tokens: 100,
          completion_tokens: 50,
          prompt_tokens_details: {
            cached_tokens: 20,
            cache_write_tokens: 10,
          },
        },
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 20,
      cacheWriteTokens: 10,
    })
  })

  it('reads Anthropic raw-only input_tokens and output_tokens', () => {
    expect(
      readLanguageModelUsageTokens({
        raw: {
          input_tokens: 1000,
          cache_creation_input_tokens: 50,
          cache_read_input_tokens: 50,
          output_tokens: 200,
        },
      }),
    ).toEqual({
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 50,
    })
  })

  it('reads Google raw-only promptTokenCount and candidatesTokenCount', () => {
    expect(
      readLanguageModelUsageTokens({
        raw: {
          promptTokenCount: 100,
          candidatesTokenCount: 40,
          thoughtsTokenCount: 50,
          cachedContentTokenCount: 20,
        },
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 40,
      cacheReadTokens: 20,
    })
  })

  it('returns undefined fields when usage is missing', () => {
    expect(readLanguageModelUsageTokens(undefined)).toEqual({})
    expect(readLanguageModelUsageTokens({})).toEqual({})
    expect(
      readLanguageModelUsageTokens({
        inputTokens: undefined,
        outputTokens: undefined,
        raw: undefined,
      }),
    ).toEqual({})
    expect(
      readLanguageModelUsageTokens({
        inputTokens: 0,
        outputTokens: 0,
        raw: { prompt_tokens: 0, completion_tokens: 0 },
      }),
    ).toEqual({})
  })

  it('falls through flattened zeros to raw provider counts', () => {
    expect(
      readLanguageModelUsageTokens({
        inputTokens: 0,
        outputTokens: 0,
        raw: { prompt_tokens: 80, completion_tokens: 12 },
      }),
    ).toEqual({
      inputTokens: 80,
      outputTokens: 12,
    })
  })
})
