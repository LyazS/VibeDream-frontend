import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertApiCapabilityEnabled } from '@/config/apiCapabilities'
import { searchTransitions } from '@/aipanel/agent/services/transitionSearchService'

afterEach(() => vi.unstubAllGlobals())

describe('formal transition search', () => {
  it('allows the formal search and sends the original top_k contract with cookie credentials', async () => {
    const response = {
      query: '淡入淡出',
      results: [{ id: 'gl-fade', name: { zh: '淡化', en: 'Fade' }, agent_description: '柔和淡化' }],
    }
    const fetcher = vi.fn(async () => Response.json(response))
    vi.stubGlobal('fetch', fetcher)
    expect(await searchTransitions('淡入淡出', 3)).toEqual(response)
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/api/effect-templates/transitions/search')
    expect(init.credentials).toBe('include')
    expect(JSON.parse(init.body as string)).toEqual({ query: '淡入淡出', top_k: 3 })
    expect(() => assertApiCapabilityEnabled('/api/effect-templates/filters')).toThrow('暂未开放')
    expect(() => assertApiCapabilityEnabled('/api/effect-templates/transitions/version')).toThrow(
      '暂未开放',
    )
  })
})
