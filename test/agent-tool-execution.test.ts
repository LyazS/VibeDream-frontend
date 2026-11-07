import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolExecutionContext } from '../src/core/agent/tools/types'
import {
  executeReadMedia,
  useReadMediaExecutionState,
} from '../src/core/agent/tools/readMedia'
import {
  executeSearchMedia,
  useSearchMediaExecutionState,
} from '../src/core/agent/tools/searchMedia'
import {
  cancelToolExecution,
  hasToolCancellationHook,
} from '../src/core/agent/tools/cancellation'

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
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
vi.mock('../src/core/agent/services/mediaIndexService', () => ({ searchMedia: mocks.search }))

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
  mocks.search.mockImplementation(
    ({ signal }: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true,
        })
      }),
  )
})

describe('tool execution cancellation', () => {
  it.each(['session', 'button'])(
    'releases read_media waiting after %s cancellation',
    async (via) => {
      const controller = new AbortController()
      const pending = executeReadMedia({ mediaIds: ['m1'] }, context(controller.signal))
      expect(useReadMediaExecutionState('c1').value?.active).toBe(true)
      expect(mocks.indexing).toHaveBeenCalledWith('m1')

      if (via === 'session') controller.abort()
      else expect(await cancelToolExecution('read_media', 'c1')).toBe(true)

      const result = await pending
      expect(JSON.parse(result.output).mediaItems[0]).toMatchObject({
        mediaId: 'm1',
        status: 'failed',
        error: '用户取消了本次素材读取',
      })
      expect(mocks.unsubscribe).toHaveBeenCalledOnce()
      expect(useReadMediaExecutionState('c1').value).toBeNull()
      expect(hasToolCancellationHook('read_media', 'c1')).toBe(false)
    },
  )

  it.each(['session', 'button'])(
    'aborts search_media requests after %s cancellation',
    async (via) => {
      const controller = new AbortController()
      const pending = executeSearchMedia({ query: 'city' }, context(controller.signal))
      const options = mocks.search.mock.calls[0][0]
      expect(options.projectId).toBe('p1')
      expect(useSearchMediaExecutionState('c1').value?.active).toBe(true)

      if (via === 'session') controller.abort()
      else expect(await cancelToolExecution('search_media', 'c1')).toBe(true)

      expect(options.signal.aborted).toBe(true)
      expect(await pending).toMatchObject({ success: false, error: '用户取消了本次素材检索' })
      expect(useSearchMediaExecutionState('c1').value).toBeNull()
      expect(hasToolCancellationHook('search_media', 'c1')).toBe(false)
    },
  )
})
