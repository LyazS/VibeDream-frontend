/** 验证转场两侧解码中有一侧失败时，另一侧已经生成的边界帧会被释放。 */
import { afterEach, expect, it, vi } from 'vitest'
import { TransitionEdgeFrameResolver } from '@/core/webgl2/transition/TransitionEdgeFrameResolver'
import { refreshClipTransitionsForItems } from '@/core/timelineitem/features/transition'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'

vi.mock('@/core/managers/filesystem/fileSystemService', async () => ({
  fileSystemService: (await import('./helpers/agent-files')).agentFileSystem,
}))

afterEach(() => vi.unstubAllGlobals())

it('releases the successful transition edge when the other asynchronous edge decode rejects', async () => {
  const item = (id: string, start: number) =>
    ({
      id,
      mediaItemId: id,
      mediaType: 'image',
      trackId: 'track',
      timelineStatus: 'ready',
      timeRange: {
        timelineStartTime: start,
        timelineEndTime: start + 30,
        clipStartTime: 0,
        clipEndTime: 30,
      },
      baseRenderConfig: { visual: {} },
      exRenderConfig: {},
      runtime: { exRenderConfig: {} },
    }) as UnifiedTimelineItemData<'image'>
  const left = item('left', 0),
    right = item('right', 30),
    close = vi.fn()
  left.exRenderConfig.transition = {
    effectPackageId: 'transition/fade@1.0.0',
    templateId: 'fade',
    packageVersion: '1.0.0',
    catalogVersion: 'v1',
    durationFrames: 10,
    params: {},
  }
  refreshClipTransitionsForItems([left, right])
  const decode = vi
    .fn()
    .mockResolvedValueOnce({ close })
    .mockRejectedValueOnce(new Error('right edge failed'))
  vi.stubGlobal('createImageBitmap', decode)
  const resolver = new TransitionEdgeFrameResolver(
    (id) => ({ id, runtime: { bunny: { imageClip: {} } } }) as UnifiedMediaItemData,
  )
  await expect(resolver.prepareItems([left, right])).rejects.toThrow('right edge failed')
  expect(close).toHaveBeenCalledOnce()
  expect(left.runtime.transition?.edgeFrames).toBeUndefined()
})
