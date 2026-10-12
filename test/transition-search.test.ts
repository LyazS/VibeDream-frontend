import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertApiCapabilityEnabled } from '@/config/apiCapabilities'
import { searchTransitions } from '@/core/agent/services/transitionSearchService'
import { cloudflareTaskProgressClient } from '@/core/utils/cloudflareTaskProgressClient'
import { runAiTask } from '@/core/ai-tasks/taskApi'

vi.mock('@/core/utils/cloudflareTaskProgressClient', () => ({
  cloudflareTaskProgressClient: { subscribe: vi.fn() },
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('formal transition search', () => {
  it('submits a typed task, waits for completion, and reads its result with cookie credentials', async () => {
    const response = {
      query: '淡入淡出',
      results: [{ id: 'gl-fade', name: { zh: '淡化', en: 'Fade' }, agent_description: '柔和淡化' }],
    }
    const taskId = crypto.randomUUID()
    const close = vi.fn()
    vi.mocked(cloudflareTaskProgressClient.subscribe).mockReturnValue({
      close,
      next: vi.fn(async () => ({
        task_id: taskId,
        type: 'transition.search',
        status: 'completed',
        revision: 3,
      })),
    })
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) =>
      Response.json(
        init?.method === 'POST'
          ? { task_id: taskId, type: 'transition.search', status: 'pending' }
          : { task_id: taskId, type: 'transition.search', result: response },
      ),
    )
    vi.stubGlobal('fetch', fetcher)
    expect(await searchTransitions('淡入淡出', 3, { projectId: 'project-transition' })).toEqual(
      response,
    )
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/api/ai/tasks')
    expect(init.credentials).toBe('include')
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'transition.search',
      project_id: 'project-transition',
      input: { query: '淡入淡出', top_k: 3 },
    })
    expect(fetcher.mock.calls[1][0]).toContain('/api/ai/tasks/' + taskId + '/result')
    expect(cloudflareTaskProgressClient.subscribe).toHaveBeenCalledWith(taskId)
    expect(close).toHaveBeenCalledOnce()
    expect(() => assertApiCapabilityEnabled('/api/effect-templates/filters')).toThrow('暂未开放')
    expect(() => assertApiCapabilityEnabled('/api/effect-templates/transitions/version')).toThrow(
      '暂未开放',
    )
  })
})

describe('shared AI task client', () => {
  function setup(status: string, returnedType = 'media.retrieval') {
    const taskId = crypto.randomUUID()
    const close = vi.fn()
    const next = vi.fn(async (_signal?: AbortSignal) => ({
      task_id: taskId,
      type: returnedType,
      status,
      revision: 3,
      message: '任务终止',
    }))
    vi.mocked(cloudflareTaskProgressClient.subscribe).mockReturnValue({ close, next })
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({ task_id: taskId, type: 'media.retrieval', status: 'pending' }),
    )
    vi.stubGlobal('fetch', fetcher)
    return { taskId, close, next, fetcher }
  }

  it.each(['failed', 'cancelled', 'input_expired'])(
    'closes the subscription and never reads a result when the task is %s',
    async (status) => {
      const { close, fetcher } = setup(status)
      await expect(
        runAiTask('media.retrieval', { query: 'test' }, { projectId: 'project-1' }),
      ).rejects.toThrow('任务终止')
      expect(close).toHaveBeenCalledOnce()
      expect(fetcher).toHaveBeenCalledOnce()
    },
  )

  it('cancels the remote task and closes its subscription on abort', async () => {
    const { taskId, close, next, fetcher } = setup('processing')
    const controller = new AbortController()
    next.mockImplementationOnce(async () => {
      controller.abort()
      throw new DOMException('Aborted', 'AbortError')
    })
    await expect(
      runAiTask('media.retrieval', {}, { projectId: 'project-1', signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher.mock.calls[1]?.[0]).toContain(`/api/ai/tasks/${taskId}/cancel`)
    expect(close).toHaveBeenCalledOnce()
  })

  it('rejects progress from a different task type', async () => {
    const { close, fetcher } = setup('completed', 'transition.search')
    await expect(runAiTask('media.retrieval', {})).rejects.toThrow('任务进度消息格式无效')
    expect(close).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('rejects an unknown task status instead of waiting indefinitely', async () => {
    const { close, fetcher } = setup('unknown')
    await expect(runAiTask('media.retrieval', {})).rejects.toThrow('任务进度消息格式无效')
    expect(close).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('rejects a result belonging to a different task', async () => {
    const { taskId, close, fetcher } = setup('completed')
    fetcher.mockResolvedValueOnce(
      Response.json({ task_id: taskId, type: 'media.retrieval', status: 'pending' }),
    )
    fetcher.mockResolvedValueOnce(Response.json({ task_id: 'other-task', result: {} }))
    await expect(runAiTask('media.retrieval', {})).rejects.toThrow('任务结果与请求任务不一致')
    expect(close).toHaveBeenCalledOnce()
  })
})
