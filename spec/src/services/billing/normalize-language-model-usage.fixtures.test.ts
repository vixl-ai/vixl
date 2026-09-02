import { describe, expect, it } from 'vitest'
import type { LanguageModelUsage } from 'ai'
import normalizeLanguageModelUsage from '@/services/billing/normalize-language-model-usage'

/**
 * Golden LanguageModelUsage fixtures mirror AI SDK provider converters after
 * `asLanguageModelUsage` flattening (ai/dist). Raw payloads match provider
 * response shapes from @ai-sdk/openai, anthropic, google, openai-compatible.
 */
describe('normalizeLanguageModelUsage fixtures', () => {
  it('OpenAI Responses: input, cache R/W, output, reasoning, orchestration raw', () => {
    // convertOpenAIResponsesUsage + asLanguageModelUsage
    const raw = {
      input_tokens: 200,
      output_tokens: 90,
      total_tokens: 290,
      input_tokens_details: {
        cached_tokens: 40,
        cache_write_tokens: 20,
        orchestration_input_tokens: 10,
        orchestration_input_cached_tokens: 5,
      },
      output_tokens_details: {
        reasoning_tokens: 30,
        orchestration_output_tokens: 8,
      },
    }
    // noCache = input - cached - cacheWrite = 200 - 40 - 20 = 140
    // text = output - reasoning = 90 - 30 = 60
    const usage: LanguageModelUsage = {
      inputTokens: 200,
      inputTokenDetails: {
        noCacheTokens: 140,
        cacheReadTokens: 40,
        cacheWriteTokens: 20,
      },
      outputTokens: 90,
      outputTokenDetails: {
        textTokens: 60,
        reasoningTokens: 30,
      },
      totalTokens: 290,
      raw,
    }

    expect(normalizeLanguageModelUsage(usage)).toEqual({
      inputTokens: 200,
      noCacheTokens: 140,
      cacheReadTokens: 40,
      cacheWriteTokens: 20,
      outputTokens: 90,
      reasoningTokens: 30,
      textTokens: 60,
      totalTokens: 290,
      raw,
      usageMissing: false,
    })
  })

  it('Anthropic: input + cache R/W, output, raw with iterations', () => {
    // convertAnthropicUsage: inputTokens.total = noCache + cacheWrite + cacheRead
    const raw = {
      input_tokens: 1000,
      cache_creation_input_tokens: 50,
      cache_read_input_tokens: 50,
      output_tokens: 200,
      iterations: [
        {
          type: 'message',
          input_tokens: 1000,
          output_tokens: 200,
          cache_creation_input_tokens: 50,
          cache_read_input_tokens: 50,
        },
      ],
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

  it('Google: input, cacheRead, output=candidates+thoughts, reasoning=thoughts', () => {
    // convertGoogleUsage: output.total = candidates + thoughts
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

  it('OpenAI-compatible/OpenRouter: prompt/completion, cacheRead from cached_tokens, cost raw', () => {
    // convertOpenAICompatibleChatUsage
    const raw = {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      cost: 0.00123,
      cost_details: { upstream_inference_cost: 0.001 },
      prompt_tokens_details: {
        cached_tokens: 20,
        cache_write_tokens: 10,
      },
      completion_tokens_details: {
        reasoning_tokens: 15,
      },
    }
    // cacheWrite is void 0 in compatible converter (not mapped into LanguageModelUsage)
    const usage: LanguageModelUsage = {
      inputTokens: 100,
      inputTokenDetails: {
        noCacheTokens: 80,
        cacheReadTokens: 20,
        cacheWriteTokens: undefined,
      },
      outputTokens: 50,
      outputTokenDetails: {
        textTokens: 35,
        reasoningTokens: 15,
      },
      totalTokens: 150,
      raw,
    }

    expect(normalizeLanguageModelUsage(usage)).toEqual({
      inputTokens: 100,
      noCacheTokens: 80,
      cacheReadTokens: 20,
      cacheWriteTokens: 10,
      outputTokens: 50,
      reasoningTokens: 15,
      textTokens: 35,
      totalTokens: 150,
      raw,
      usageMissing: false,
    })
  })

  it('local ollama: no usage (null LanguageModelUsage fields) => usageMissing', () => {
    // createNullLanguageModelUsage when provider returns no usage
    const usage: LanguageModelUsage = {
      inputTokens: undefined,
      inputTokenDetails: {
        noCacheTokens: undefined,
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
      },
      outputTokens: undefined,
      outputTokenDetails: {
        textTokens: undefined,
        reasoningTokens: undefined,
      },
      totalTokens: undefined,
      raw: undefined,
    }

    expect(normalizeLanguageModelUsage(usage)).toEqual({
      usageMissing: true,
    })
  })

  it('OpenAI raw-only (no flattened counts) => tokens from prompt/completion', () => {
    const raw = {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    }
    const usage = { raw } as unknown as LanguageModelUsage

    expect(normalizeLanguageModelUsage(usage)).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      raw,
      usageMissing: false,
    })
  })

  it('Anthropic raw-only (no flattened counts) => tokens from input/output', () => {
    const raw = {
      input_tokens: 1000,
      cache_creation_input_tokens: 50,
      cache_read_input_tokens: 50,
      output_tokens: 200,
    }
    const usage = { raw } as unknown as LanguageModelUsage

    expect(normalizeLanguageModelUsage(usage)).toEqual({
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 50,
      raw,
      usageMissing: false,
    })
  })

  it('undefined usage => usageMissing true', () => {
    expect(normalizeLanguageModelUsage(undefined)).toEqual({
      usageMissing: true,
    })
  })

  it('all-zero usage => usageMissing true while preserving fields', () => {
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
})
