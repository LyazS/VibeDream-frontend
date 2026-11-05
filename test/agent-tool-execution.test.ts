import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolExecutionContext } from '../src/core/agent/tools/types'
import {
  executeReadMedia,
  useReadMediaExecutionState,
} from '../src/core/agent/tools/readMedia'
import { hasToolCancellationHook } from '../src/core/agent/tools/cancellation'

const mocks = vi.hoisted(() => ({
  indexing: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}))
vi.mock('../src/core/unifiedStore', () => ({
  useUnifiedStore: () => ({
    projectId: 'p1',
    mediaItems: [{ id: 'm1', name: 'Image', mediaType: 'image', runtime: {}, metadata: {} }],
    ensureMediaIndexing: mocks.indexing,
    jobRuntime: { onResourceEvent: mocks.subscribe },
  }),
}))
function context(signal: AbortSignal): ToolExecutionContext {
  return {
    toolCallId: 'c1',
    userId: 'u1',
    projectId: 'p1',
    sessionId: 's1',
    modelCallId: 't1',
    signal,
    isCurrent: () => !signal.aborted,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.indexing.mockImplementation(() => new Promise(() => {}))
  mocks.subscribe.mockReturnValue(mocks.unsubscribe)
})

describe('tool execution cancellation', () => {
  it('returns basic media details without registering indexing or cancellation work', async () => {
    const result = await executeReadMedia({ mediaIds: ['m1'] }, context(new AbortController().signal))
    expect(JSON.parse(result.output).mediaItems[0]).toMatchObject({
      mediaId: 'm1',
      status: 'found',
      basic: { name: 'Image' },
    })
    expect(mocks.indexing).not.toHaveBeenCalled()
    expect(mocks.subscribe).not.toHaveBeenCalled()
    expect(useReadMediaExecutionState('c1').value).toBeNull()
    expect(hasToolCancellationHook('read_media', 'c1')).toBe(false)
  })

})
