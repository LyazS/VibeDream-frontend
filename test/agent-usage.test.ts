import { describe, expect, it } from 'vitest'
import { getAgentContextUsage, summarizeAgentUsage } from '../src/core/agent/runtime/AgentUsage'

describe('Agent session usage', () => {
  it('uses the latest measured call for context rather than cumulative consumption', () => {
    const records = {
      first: {
        usage: { inputTokens: 600, outputTokens: 50, totalTokens: 650 },
        chargedAmount: '0',
        contextWindowTokens: 1000,
      },
      latest: {
        usage: { inputTokens: 700, outputTokens: 100, totalTokens: 800 },
        chargedAmount: '0',
        contextWindowTokens: 1000,
      },
      pending: { usage: null, chargedAmount: null },
    }
    expect(getAgentContextUsage(records)).toEqual({
      usedTokens: 800,
      limitTokens: 1000,
      ratio: 0.8,
    })
    expect(getAgentContextUsage(records, 'first').ratio).toBe(0.65)
    expect(
      getAgentContextUsage(
        {
          ...records,
          notCalled: {
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            chargedAmount: '0',
            contextWindowTokens: 1000,
          },
        },
        'notCalled',
      ).ratio,
    ).toBe(0.8)
    expect(getAgentContextUsage({})).toEqual({ usedTokens: null, limitTokens: null, ratio: null })
    expect(
      getAgentContextUsage({ legacy: { usage: records.latest.usage, chargedAmount: '0' } }).ratio,
    ).toBeNull()
    expect(
      getAgentContextUsage({ over: { ...records.latest, contextWindowTokens: 500 } }).ratio,
    ).toBe(1)
  })

  it('keeps cached input inside input totals and sums charges exactly', () => {
    const result = summarizeAgentUsage({
      first: {
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, cachedInputTokens: 8 },
        chargedAmount: '0.00000001',
      },
      second: {
        usage: { inputTokens: 20, outputTokens: 3, totalTokens: 23, cachedInputTokens: 12 },
        chargedAmount: '0.00000002',
      },
    })
    expect(result).toEqual({
      inputTokens: { value: 30, complete: true },
      outputTokens: { value: 5, complete: true },
      cachedInputTokens: { value: 20, complete: true },
      chargedAmount: { value: '0.00000003', complete: true },
    })
  })

  it('distinguishes missing usage, missing cache details and a new session', () => {
    expect(summarizeAgentUsage({}).chargedAmount).toEqual({ value: '0', complete: true })
    const result = summarizeAgentUsage({
      old: { usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 }, chargedAmount: null },
      unknown: { usage: null, chargedAmount: null },
    })
    expect(result.inputTokens).toEqual({ value: 10, complete: false })
    expect(result.outputTokens).toEqual({ value: 2, complete: false })
    expect(result.cachedInputTokens).toEqual({ value: null, complete: false })
    expect(result.chargedAmount).toEqual({ value: null, complete: false })
  })
})
