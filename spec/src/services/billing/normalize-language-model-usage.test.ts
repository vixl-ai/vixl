import { describe, expect, it } from 'vitest'
import type { LanguageModelUsage } from 'ai'
import normalizeLanguageModelUsage from '@/services/billing/normalize-language-model-usage'

describe('normalizeLanguageModelUsage', () => {
  it('marks undefined usage as missing and never backfills tokens', () => {
    expect(normalizeLanguageModelUsage(undefined)).toEqual({
      usageMissing: true,
    })
  })

  it('marks all-zero usage as missing while preserving raw', () => {
    const usage: LanguageModelUsage = {
      inputTokens: 0,
      inputTokenDetails: {
        noCacheTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      outputTokens: 0,
      outputTokenDetails: {
        textTokens: 0,
        reasoningTokens: 0,
      },
      totalTokens: 0,
      raw: { prompt_tokens: 0, completion_tokens: 0 },
    }

    expect(normalizeLanguageModelUsage(usage)).toEqual({
      inputTokens: 0,
      noCacheTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      textTokens: 0,
      totalTokens: 0,
      raw: { prompt_tokens: 0, completion_tokens: 0 },
      usageMissing: true,
    })
  })

  it('copies Anthropic-style cache usage verbatim', () => {
    const raw = {
      input_tokens: 1000,
      cache_creation_input_tokens: 50,
      cache_read_input_tokens: 50,
      output_tokens: 200,
    }
    const usage: LanguageModelUsage = {
      inputTokens: 1100,
      inputTokenDetails: {
        noCacheTokens: 1000,
        cacheReadTokens: 50,
        cacheWriteTokens: 50,
      },
      outputTokens: 200,
      outputTokenDetails: {
        textTokens: undefined,
        reasoningTokens: undefined,
      },
      totalTokens: 1300,
      raw,
    }

    expect(normalizeLanguageModelUsage(usage)).toEqual({
      inputTokens: 1100,
      noCacheTokens: 1000,
      cacheReadTokens: 50,
      cacheWriteTokens: 50,
      outputTokens: 200,
      totalTokens: 1300,
      raw,
      usageMissing: false,
    })
  })

  it('copies Google thoughts usage verbatim', () => {
    const raw = {
      promptTokenCount: 100,
      candidatesTokenCount: 100,
      thoughtsTokenCount: 50,
      cachedContentTokenCount: 20,
    }
    const usage: LanguageModelUsage = {
      inputTokens: 100,
      inputTokenDetails: {
        noCacheTokens: 80,
        cacheReadTokens: 20,
        cacheWriteTokens: undefined,
      },
      outputTokens: 150,
      outputTokenDetails: {
        textTokens: 100,
        reasoningTokens: 50,
      },
      totalTokens: 250,
      raw,
    }

    expect(normalizeLanguageModelUsage(usage)).toEqual({
      inputTokens: 100,
      noCacheTokens: 80,
      cacheReadTokens: 20,
      outputTokens: 150,
      reasoningTokens: 50,
      textTokens: 100,
      totalTokens: 250,
      raw,
      usageMissing: false,
    })
  })

  it('copies OpenAI Responses reasoning and cache usage verbatim', () => {
    const raw = {
      input_tokens: 120,
      output_tokens: 80,
      total_tokens: 200,
      input_tokens_details: { cached_tokens: 40 },
      output_tokens_details: { reasoning_tokens: 25 },
    }
    const usage: LanguageModelUsage = {
      inputTokens: 120,
      inputTokenDetails: {
        noCacheTokens: 80,
        cacheReadTokens: 40,
        cacheWriteTokens: undefined,
      },
      outputTokens: 80,
      outputTokenDetails: {
        textTokens: 55,
        reasoningTokens: 25,
      },
      totalTokens: 200,
      raw,
    }

    expect(normalizeLanguageModelUsage(usage)).toEqual({
      inputTokens: 120,
      noCacheTokens: 80,
      cacheReadTokens: 40,
      outputTokens: 80,
      reasoningTokens: 25,
      textTokens: 55,
      totalTokens: 200,
      raw,
      usageMissing: false,
    })
  })

  it('fills inputTokens and outputTokens from raw when flattened counts are missing', () => {
    const raw = { prompt_tokens: 100, completion_tokens: 50 }
    const usage = {
      raw,
    } as unknown as LanguageModelUsage

    expect(normalizeLanguageModelUsage(usage)).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      raw,
      usageMissing: false,
    })
  })

  it('does not throw when token details are missing', () => {
    const usage = {
      inputTokens: 10,
      outputTokens: 4,
    } as unknown as LanguageModelUsage

    expect(normalizeLanguageModelUsage(usage)).toEqual({
      inputTokens: 10,
      outputTokens: 4,
      usageMissing: false,
    })
  })
})
