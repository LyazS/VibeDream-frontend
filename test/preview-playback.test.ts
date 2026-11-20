import { nextTick, ref } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ModuleRegistry, MODULE_NAMES } from '@/core/modules/ModuleRegistry'
import {
  createUnifiedMediaBunnyModule,
  type UnifiedMediaBunnyModule,
} from '@/core/modules/UnifiedMediaBunnyModule'
import { createUnifiedPlaybackModule } from '@/core/modules/UnifiedPlaybackModule'

const preview = vi.hoisted(() => ({
  tick: undefined as (() => void) | undefined,
  render: vi.fn(),
}))

vi.mock('mediabunny', () => ({ canEncodeAudio: async () => true }))
vi.mock('@mediabunny/mp3-encoder', () => ({ registerMp3Encoder: vi.fn() }))
vi.mock('@/core/mediabunny/worker-timer', () => ({
  workerTimer(tick: () => void) {
    preview.tick = tick
    return () => {
      preview.tick = undefined
    }
  },
}))
vi.mock('@/core/mediabunny/TimelineItemsBufferManager', () => ({
  TimelineItemsBufferManager: class {
    getItemsForRendering(items: unknown[]) {
      return items
    }
    shouldUpdateBuffer = () => false
    getBufferedItemIds = () => new Set()
    clearBuffers = () => {}
  },
}))
vi.mock('@/core/utils/animationInterpolation', () => ({ applyAnimationToConfig: vi.fn() }))
vi.mock('@/core/timelineitem/queries', () => ({
  TimelineItemQueries: {
    isVideoTimelineItem: (item: { mediaType: string }) => item.mediaType === 'video',
    isAudioTimelineItem: (item: { mediaType: string }) => item.mediaType === 'audio',
    getResolvedRenderConfig: () => ({ audio: {} }),
  },
}))
vi.mock('@/core/utils/timelineFrameCapture', () => ({}))
vi.mock('@/core/webgl2/renderer/TimelineWebGLRenderer', () => ({
  TimelineWebGLRenderer: class {
    render = preview.render
    clear = vi.fn()
    dispose = vi.fn()
  },
}))
vi.mock('@/core/webgl2/transition/TransitionEdgeFrameResolver', () => ({
  TransitionEdgeFrameResolver: class {
    prepareItems = vi.fn()
  },
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

let mediaBunny: UnifiedMediaBunnyModule | undefined

async function setUp(endFrameN: number, timelineItems: unknown[] = []) {
  const audioContext = {
    currentTime: 0,
    state: 'running' as AudioContextState,
    destination: {},
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    createGain: () => ({ connect: vi.fn(), gain: { value: 1 } }),
    createBufferSource: vi.fn(() => ({
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      playbackRate: { value: 1 },
    })),
  }
  vi.stubGlobal('AudioContext', function () {
    return audioContext
  })

  const registry = new ModuleRegistry()
  registry.register(MODULE_NAMES.TIMELINE, { timelineItems: ref(timelineItems) })
  registry.register(MODULE_NAMES.MEDIA, {})
  registry.register(MODULE_NAMES.CONFIG, {})
  registry.register(MODULE_NAMES.TRACK, { getTrack: () => undefined })
  registry.register(MODULE_NAMES.SELECTION, { selectedClipTimelineItemId: ref(null) })
  const playback = createUnifiedPlaybackModule(registry)
  mediaBunny = createUnifiedMediaBunnyModule(registry, ref(endFrameN), {
    currentFrame: playback.currentFrame,
    isPlaying: playback.isPlaying,
    onFrame: playback.onPreviewFrame,
    onEnded: playback.onPreviewEnded,
  })
  registry.register(MODULE_NAMES.MEDIABUNNY, mediaBunny)
  await mediaBunny.setCanvas({ width: 1280, height: 720 } as HTMLCanvasElement)
  return { audioContext, playback }
}

function clipWithDecoder(tickN: ReturnType<typeof vi.fn>, endFrameN: number) {
  return {
    id: 'clip',
    mediaType: 'video',
    trackId: 'track',
    timeRange: { timelineStartTime: 0, timelineEndTime: endFrameN },
    runtime: { bunnyClip: { tickN, clockwiseRotation: 0, getPlaybackRate: () => 1 } },
  }
}

async function tickPreview() {
  vi.advanceTimersByTime(34)
  preview.tick?.()
  await nextTick()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'performance'] })
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
  await mediaBunny?.destroy()
  mediaBunny = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('updates the playhead immediately and samples the latest seek on the throttled preview', async () => {
  const tickN = vi.fn(async () => ({ state: 'success', video: { close: vi.fn() } }))
  const { playback } = await setUp(180, [clipWithDecoder(tickN, 180)])

  playback.seekToFrame(10)
  expect(playback.currentFrame.value).toBe(10)
  expect(tickN).not.toHaveBeenCalled()
  await nextTick()
  await tickPreview()

  playback.seekToFrame(40)
  await nextTick()
  playback.seekToFrame(120)
  expect(playback.currentFrame.value).toBe(120)
  await nextTick()
  await tickPreview()
  expect(tickN.mock.calls).toEqual([[10n, false, true]])

  await tickPreview()
  expect(tickN.mock.calls).toEqual([
    [10n, false, true],
    [120n, false, true],
  ])
  expect(preview.render.mock.lastCall?.[1]).toBe(120)
})

it('starts playing from the latest target while a throttled seek is pending', async () => {
  const { audioContext, playback } = await setUp(180)
  playback.seekToFrame(10)
  await nextTick()
  await tickPreview()
  playback.seekToFrame(30)
  await nextTick()
  expect(preview.render.mock.lastCall?.[1]).toBe(10)

  await playback.play()
  await tickPreview()
  await tickPreview()
  audioContext.currentTime = 1
  await tickPreview()
  expect(playback.currentFrame.value).toBe(60)
  expect(preview.render.mock.lastCall?.[1]).toBe(60)
})

it.each(['natural end', 'manual pause'] as const)(
  'clears queued and in-flight audio on %s',
  async (reason) => {
    const decodedAudio = { state: 'success', audio: [{ buffer: {}, timestamp: 0.25 }] }
    const pendingDecode = deferred<typeof decodedAudio>()
    const tickN = vi
      .fn()
      .mockResolvedValueOnce(decodedAudio)
      .mockReturnValueOnce(pendingDecode.promise)
      .mockResolvedValue({ state: 'outofrange' })
    const { audioContext, playback } = await setUp(60, [clipWithDecoder(tickN, 60)])

    await playback.play()
    audioContext.currentTime = 0.25
    await tickPreview()
    expect(playback.currentFrame.value).toBe(7)
    expect(audioContext.createBufferSource).toHaveBeenCalledOnce()

    audioContext.currentTime = 0.5
    await tickPreview()
    expect(tickN).toHaveBeenCalledTimes(2)

    if (reason === 'natural end') {
      audioContext.currentTime = 2
      await tickPreview()
    } else {
      await playback.pause()
    }

    expect(playback.isPlaying.value).toBe(false)
    expect(playback.currentFrame.value).toBe(reason === 'natural end' ? 60 : 15)
    expect(audioContext.createBufferSource.mock.results[0]?.value.stop).toHaveBeenCalledOnce()

    pendingDecode.resolve(decodedAudio)
    await tickPreview()
    expect(audioContext.createBufferSource).toHaveBeenCalledOnce()
    expect(preview.render.mock.lastCall?.[1]).toBe(playback.currentFrame.value)
  },
)

it('cancels a pending start when the user pauses during audio resume', async () => {
  const { audioContext, playback } = await setUp(60)
  const waitingForAudio = deferred<void>()
  audioContext.state = 'suspended'
  audioContext.resume.mockReturnValueOnce(waitingForAudio.promise)

  const starting = playback.play()
  await playback.pause()
  waitingForAudio.resolve(undefined)
  await starting
  expect(playback.isPlaying.value).toBe(false)

  await playback.play()
  expect(playback.isPlaying.value).toBe(true)
})
