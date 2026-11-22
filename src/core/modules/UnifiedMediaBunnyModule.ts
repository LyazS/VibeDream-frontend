/**
 * UnifiedMediaBunnyModule - MediaBunny 渲染系统模块
 *
 * 管理音频时钟、音频节点、解码缓冲和预览渲染。Canvas 由 Vue 组件传入。
 * 播放时上报时钟对应的时间轴帧和结束事件，暂停时监听播放头并节流采样。
 */

import { ref, watch, type Ref } from 'vue'
import { workerTimer } from '@/core/mediabunny/worker-timer'
import { RENDERER_FPS, AUDIO_DEFAULT_SAMPLE_RATE } from '@/core/mediabunny/constant'
import { throttle } from 'lodash'
import { canEncodeAudio } from 'mediabunny'
import { registerMp3Encoder } from '@mediabunny/mp3-encoder'
import { ModuleRegistry, MODULE_NAMES } from './ModuleRegistry'
import type { UnifiedTimelineModule } from './UnifiedTimelineModule'
import type { UnifiedMediaModule } from './UnifiedMediaModule'
import type { UnifiedConfigModule } from './UnifiedConfigModule'
import type { UnifiedTrackModule } from './UnifiedTrackModule'
import type { UnifiedSelectionModule } from './UnifiedSelectionModule'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { MediaType } from '@/core/mediaitem/types'
import type { WrappedAudioBuffer } from 'mediabunny'
import { applyAnimationToConfig } from '@/core/utils/animationInterpolation'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import { type FrameData } from '@/core/webgl2/types'
import { TimelineItemsBufferManager } from '@/core/mediabunny/TimelineItemsBufferManager'
import { TimelineWebGLRenderer } from '@/core/webgl2/renderer/TimelineWebGLRenderer'
import {
  downloadBlob,
  type CaptureTimelineFrameOptions,
  TimelineFrameCaptureSession,
} from '@/core/utils/timelineFrameCapture'

if (!(await canEncodeAudio('mp3'))) {
  registerMp3Encoder()
  console.log('已注册mp3编码器')
}

/** 预览引擎读取控制器的状态，再通过回调上报音频时钟对应的帧和播完事件。 */
interface PreviewPlaybackBinding {
  readonly currentFrame: Readonly<Ref<number>>
  readonly isPlaying: Readonly<Ref<boolean>>
  onFrame(frameN: number): void
  onEnded(endFrameN: number): void
}

export function createUnifiedMediaBunnyModule(
  registry: ModuleRegistry,
  contentEndTimeN: Ref<number>,
  playback: PreviewPlaybackBinding,
) {
  const timelineModule = registry.get<UnifiedTimelineModule>(MODULE_NAMES.TIMELINE)
  const mediaModule = registry.get<UnifiedMediaModule>(MODULE_NAMES.MEDIA)
  const configModule = registry.get<UnifiedConfigModule>(MODULE_NAMES.CONFIG)
  const trackModule = registry.get<UnifiedTrackModule>(MODULE_NAMES.TRACK)
  const selectionModule = registry.get<UnifiedSelectionModule>(MODULE_NAMES.SELECTION)

  // ==================== 状态定义 ====================

  // 模块就绪状态
  const isMediaBunnyReady = ref(false)
  const mediaBunnyError = ref<string | null>(null)

  // Canvas 相关（由外部传入）
  let mCanvas: HTMLCanvasElement | null = null
  let mWebGLRenderer: TimelineWebGLRenderer | null = null

  // 渲染循环相关
  let mRenderLoopCleanup: (() => void) | null = null
  let mPlaybackListenersCleanup: (() => void) | null = null
  const mExpectFrameTimeMs: number = 1000 / RENDERER_FPS
  let mUpdatingClip: boolean = false

  // ✨ 双缓冲管理器
  let mBufferManager: TimelineItemsBufferManager | null = null

  // Web Audio API 相关
  let mAudioContext: AudioContext | null = null
  let mGainNode: GainNode | null = null

  // 音频调度相关
  const mQueuedAudioNodes = new Set<AudioBufferSourceNode>()
  // 音频调度序号。清理音频时递增，解码返回后仅在序号仍匹配时调度音频。
  // 这样暂停、停止或定位前发起的解码即使稍后完成，也会跳过音频入队。
  let mAudioScheduleGenerationN = 0

  // 时间同步锚点（用于音频调度）
  let mAudioContextStartTimeS: number | null = null
  let mPlaybackTimeAtStartS: number = 0

  // 最近一次提交给 clip 更新流程的帧，用于判断预览是否需要追上播放头。
  const mCurrentBunnyFrameN = ref(0)
  // 项目时长（帧数）
  let mTimelineDurationN: number = 0

  // bunnyCurFrame 映射表（key: timelineItemId, value: FrameData）
  const mBunnyCurFrameMap = new Map<string, FrameData>()

  // ==================== 画布管理 ====================

  /**
   * 设置 Canvas 元素并初始化渲染系统
   * @param canvasElement Canvas 元素引用（从 BunnyRender.vue 传入）
   */
  async function setCanvas(canvasElement: HTMLCanvasElement): Promise<void> {
    try {
      if (!canvasElement) {
        throw new Error('Canvas 元素不能为空')
      }

      // 设置 Canvas 引用
      mCanvas = canvasElement
      mWebGLRenderer = new TimelineWebGLRenderer({
        canvas: mCanvas,
        getTrack: (trackId: string) => trackModule.getTrack(trackId),
        getMediaItem: (mediaItemId: string) => mediaModule.getMediaItem(mediaItemId),
        trackIndexMap: () => trackModule.trackIndexMap.value,
        getSelectedTimelineItemId: () => selectionModule.selectedClipTimelineItemId.value,
      })
      console.log('✅ Canvas 元素已设置', {
        width: mCanvas.width,
        height: mCanvas.height,
      })

      // ✨ 初始化缓冲管理器
      mBufferManager = new TimelineItemsBufferManager(RENDERER_FPS)

      // 初始化音频系统
      initializeAudioSystem()
      // 设置播放监听器
      setupPlaybackListeners()
      // 初始化就启动渲染循环
      startRenderLoop()

      // 标记为就绪
      isMediaBunnyReady.value = true
      mediaBunnyError.value = null

      console.log('✅ MediaBunny 渲染系统初始化完成')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      mediaBunnyError.value = `MediaBunny 初始化失败: ${errorMessage}`
      isMediaBunnyReady.value = false
      throw error
    }
  }

  /**
   * 销毁 MediaBunny 渲染系统
   */
  async function destroy(): Promise<void> {
    console.log('🧹 清理 MediaBunny 渲染系统资源')

    // 停止渲染循环
    stopRenderLoop()
    mPlaybackListenersCleanup?.()
    mPlaybackListenersCleanup = null

    // 停止所有音频
    stopAllAudioNodes()

    // 清空 Canvas（如果存在）
    if (mCanvas && mWebGLRenderer) {
      mWebGLRenderer.clear()
    }

    // 关闭 AudioContext
    const audioContext = mAudioContext
    mAudioContext = null
    mAudioContextStartTimeS = null

    // 清理 bunnyCurFrameMap 中的所有 VideoSample
    for (const [_itemId, frameData] of mBunnyCurFrameMap) {
      frameData.videoSample.close()
    }
    mBunnyCurFrameMap.clear()

    // ✨ 清理缓冲管理器
    if (mBufferManager) {
      mBufferManager.clearBuffers()
      mBufferManager = null
    }

    // 清理引用（不删除 canvas 元素，由 Vue 组件管理）
    mWebGLRenderer?.dispose()
    mWebGLRenderer = null
    mCanvas = null
    mGainNode = null

    // 清理状态
    isMediaBunnyReady.value = false

    await audioContext?.close()
    console.log('✅ MediaBunny 渲染系统资源清理完成')
  }

  // ==================== 渲染循环 ====================

  /**
   * 启动渲染循环
   */
  function startRenderLoop(): void {
    if (mRenderLoopCleanup) {
      console.warn('⚠️ 渲染循环已在运行')
      return
    }

    const renderStartMs = performance.now()
    let renderRunCntN = 0
    mRenderLoopCleanup = workerTimer(() => {
      // 使用真实时间作为基准，避免音画不同步
      if ((performance.now() - renderStartMs) / (mExpectFrameTimeMs * renderRunCntN) < 1) {
        return
      }

      const isPlaying = playback.isPlaying.value
      const currentTimeN = Math.floor(getCurrentPlaybackTimeS() * RENDERER_FPS)

      // 引擎上报时间轴末尾，由 Playback 更新播放状态并调用音频清理。
      if (isPlaying && currentTimeN >= mTimelineDurationN) {
        playback.onEnded(mTimelineDurationN)
        console.log('✅ 播放结束')
        return
      }

      // 不断更新clip帧数据,如果是播放则需要解码音频
      updateClips(timelineModule.timelineItems.value, currentTimeN, isPlaying)
      if (isPlaying) playback.onFrame(currentTimeN)

      // 渲染到 Canvas（使用 bunnyCurFrameMap 和 runtime 中的数据）
      renderToCanvasWrapper(timelineModule.timelineItems.value, currentTimeN)

      renderRunCntN++
    }, mExpectFrameTimeMs)

    console.log('🎬 MediaBunny 渲染循环已启动')
  }

  /**
   * 停止渲染循环
   */
  function stopRenderLoop(): void {
    if (mRenderLoopCleanup) {
      mRenderLoopCleanup()
      mRenderLoopCleanup = null
      console.log('⏸️ MediaBunny 渲染循环已停止')
    }
  }

  /**
   * 获取当前播放时间（秒）
   * 使用 AudioContext 时钟作为基准，确保精确同步
   */
  function getCurrentPlaybackTimeS(): number {
    if (!playback.isPlaying.value || !mAudioContext || mAudioContextStartTimeS === null) {
      return mPlaybackTimeAtStartS
    }

    return mAudioContext.currentTime - mAudioContextStartTimeS + mPlaybackTimeAtStartS
  }

  function removeCurrentVideoFrame(itemId: string): void {
    const oldFrame = mBunnyCurFrameMap.get(itemId)
    oldFrame?.videoSample.close()
    mBunnyCurFrameMap.delete(itemId)
  }

  function storeCurrentVideoFrame(
    itemId: string,
    frameNumberN: number,
    clockwiseRotation: number,
    videoSample: FrameData['videoSample'],
  ): void {
    removeCurrentVideoFrame(itemId)
    mBunnyCurFrameMap.set(itemId, {
      frameNumber: frameNumberN,
      clockwiseRotation,
      videoSample,
    })
  }

  async function warmPreparedClipStartFrames(
    items: UnifiedTimelineItemData<MediaType>[],
    currentFrameN: number,
  ): Promise<void> {
    const warmTasks: Promise<void>[] = []

    for (const item of items) {
      // 这里只为视频首帧做预热落图；音频仍走正常播放时钟调度。
      if (!TimelineItemQueries.isVideoTimelineItem(item)) {
        continue
      }

      // 只预热未来 clip。当前或过去的 clip 继续走常规 updateClipFrame，
      // 避免和正在推进的解码状态互相覆盖。
      if (item.timeRange.timelineStartTime <= currentFrameN) {
        continue
      }

      const bunnyClip = item.runtime.bunnyClip
      if (!bunnyClip) {
        continue
      }

      const warmTask = bunnyClip
        .tickN(BigInt(item.timeRange.timelineStartTime), false, true)
        .then(({ video, state }) => {
          if (state !== 'success' || !video) {
            return
          }

          // prepare() 只是把首帧留在 BunnyClip 内部 ready 状态；
          // 这里显式取出 timelineStart 对应的视频帧，提前放进渲染 map，
          // 这样播放头真正走到 clip 首帧时，render 不会先看到一个空洞。
          storeCurrentVideoFrame(
            item.id,
            item.timeRange.timelineStartTime,
            bunnyClip.clockwiseRotation,
            video,
          )
        })
        .catch((error) => {
          console.error(`❌ 预热 clip 首帧失败: ${item.id}`, error)
        })

      warmTasks.push(warmTask)
    }

    if (warmTasks.length > 0) {
      await Promise.all(warmTasks)
    }
  }

  function cleanupBufferedPlaybackFrames(currentFrameN: number): void {
    if (!mBufferManager) {
      return
    }

    // 预热首帧可能会让 future clip 在进入可见区前就占住一个 VideoSample，
    // 播放窗口滑走后需要主动清掉，避免 map 里长期残留旧帧。
    const bufferedItemIds = mBufferManager.getBufferedItemIds(currentFrameN)
    if (bufferedItemIds.size === 0) {
      return
    }

    for (const [itemId] of mBunnyCurFrameMap) {
      if (bufferedItemIds.has(itemId)) {
        continue
      }

      removeCurrentVideoFrame(itemId)
    }
  }

  /**
   * 更新单个 clip 的帧数据
   * 异步调用 bunnyClip.tickN() 更新 bunnyCurFrameMap 和处理音频
   * @param item 时间轴项目
   * @param currentTimeN 当前时间（帧数）
   * @param shouldPlayAudio 是否应该播放音频（考虑轨道和项目静音状态）
   */
  async function updateClipFrame(
    item: UnifiedTimelineItemData<MediaType>,
    currentTimeN: number,
    shouldPlayAudio: boolean,
    volume: number,
    // sampleFrameN 允许预览层在不改变播放头位置的前提下，采样相邻帧。
    // 当前主要用于“选中 clip 且停在 timelineEndTime”时回退显示尾帧。
    sampleFrameN: number = currentTimeN,
  ): Promise<void> {
    const bunnyClip = item.runtime.bunnyClip
    if (!bunnyClip) return

    // 检查当前帧数是否需要更新
    const frameData = mBunnyCurFrameMap.get(item.id)
    if (frameData?.frameNumber === currentTimeN) {
      // 帧数相同，跳过更新
      return
    }

    // 异步更新帧数据
    // tickN 内部限制必须解码完才能解码下一个
    // 未解码完就再次执行 tickN 会返回 ‘skip’
    // 这是第二层频率限制
    // 记录发起解码时的音频调度序号，返回后用它判断这批音频是否仍有效。
    const audioGenerationN = mAudioScheduleGenerationN
    const { audio, video, state } = await bunnyClip.tickN(
      BigInt(sampleFrameN),
      shouldPlayAudio, //根据轨道和项目静音状态决定是否请求音频
      true, //总是请求视频帧
    )
    if (state === 'skip') {
      // 什么都不做，调用 tickN 太频繁了
    } else if (state === 'success') {
      // 更新 bunnyCurFrameMap
      if (video) {
        storeCurrentVideoFrame(item.id, currentTimeN, bunnyClip.clockwiseRotation, video)
      }

      // 调度音频（只在需要播放音频时）
      if (shouldPlayAudio && audio && audioGenerationN === mAudioScheduleGenerationN) {
        scheduleAudioBuffers(audio, bunnyClip.getPlaybackRate(), volume)
      }
    } else {
      // 清理无效帧
      removeCurrentVideoFrame(item.id)
    }
  }

  /**
   * 更新所有 clips
   * 调用 bunnyClip.tickN() 更新 bunnyCurFrameMap 和处理音频
   */
  function updateClips(
    timelineItems: UnifiedTimelineItemData<MediaType>[],
    currentTimeN: number,
    isPlaying: boolean,
  ): void {
    // mUpdatingClip 可以防止过度更新
    // 这是第一层防御，第二层在clip内部来限制过度更新
    if (mUpdatingClip) return
    mUpdatingClip = true

    // ✨ 使用缓冲管理器获取要处理的 items
    const itemsToProcess =
      mBufferManager && isPlaying
        ? mBufferManager.getItemsForRendering(timelineItems, currentTimeN)
        : timelineItems

    // ✨ 检查是否需要更新后台缓冲
    if (isPlaying && mBufferManager && mBufferManager.shouldUpdateBuffer(currentTimeN)) {
      // 异步更新后台缓冲，不阻塞当前渲染。
      // 这里先预热 render chain 和转场边界帧，减少进入播放窗口后的首次准备成本。
      void mBufferManager
        .updateBackBuffer(timelineItems, currentTimeN)
        .then(({ bufferedItems, newlyPreparedItems }) => {
          mWebGLRenderer?.prepareRenderChains(bufferedItems)
          void warmPreparedClipStartFrames(newlyPreparedItems, currentTimeN)
        })
    }

    if (isPlaying) {
      cleanupBufferedPlaybackFrames(currentTimeN)
    }

    const selectedTimelineItemId = selectionModule.selectedClipTimelineItemId.value

    for (const item of itemsToProcess) {
      const shouldPreviewSelectedBoundaryFrame =
        selectedTimelineItemId === item.id &&
        TimelineItemQueries.hasVisualProperties(item) &&
        currentTimeN === item.timeRange.timelineEndTime
      const boundarySampleFrameN = shouldPreviewSelectedBoundaryFrame
        ? Math.max(item.timeRange.timelineStartTime, item.timeRange.timelineEndTime - 1)
        : currentTimeN

      // 属性动画允许在选中 clip 的尾部边界帧操作，视频采样仍取最后一个可解码帧。
      applyAnimationToConfig(item, currentTimeN)

      // 处理视频/音频
      if (
        TimelineItemQueries.isVideoTimelineItem(item) ||
        TimelineItemQueries.isAudioTimelineItem(item)
      ) {
        // future item 如果继续走常规 tickN(currentTimeN)，会得到 outofrange，
        // 从而把刚才预热写入的首帧立刻删掉，所以播放态下要先跳过。
        if (isPlaying && currentTimeN < item.timeRange.timelineStartTime) {
          continue
        }

        const track = trackModule.getTrack(item.trackId)
        const isTrackMuted = track?.isMuted ?? false

        // ✅ 使用辅助函数获取渲染配置（包含动画插值后的音量）
        const config = TimelineItemQueries.getResolvedRenderConfig(item)
        const isItemMuted = config.audio.isMuted ?? false
        const itemVolume = config.audio.volume ?? 1.0
        const shouldRenderSelectedVideoBoundaryFrame =
          shouldPreviewSelectedBoundaryFrame && TimelineItemQueries.isVideoTimelineItem(item)
        const shouldPlayAudioForItem =
          !shouldRenderSelectedVideoBoundaryFrame && isPlaying && !isTrackMuted && !isItemMuted
        const sampleFrameN = shouldRenderSelectedVideoBoundaryFrame
          ? boundarySampleFrameN
          : currentTimeN

        // 更新 clip 帧数据（不等待完成，使用 void）
        // 这里不等待，因此会后台执行，飞快地跳过这里，导致整个 updateClips 都会快速执行一遍
        // 按照 workerTimer 频率来执行，可能会在解码慢跟不上的时候多次重复执行
        // 因此内部也需要一些策略来限制频率
        void updateClipFrame(item, currentTimeN, shouldPlayAudioForItem, itemVolume, sampleFrameN)
      }
    }

    mCurrentBunnyFrameN.value = currentTimeN
    mUpdatingClip = false
  }

  /**
   * 渲染到 Canvas 的包装函数
   * 调用独立的 renderToCanvas 工具函数
   *
   * @param timelineItems 时间轴项目列表
   * @param currentTimeN 当前播放时间（帧数）
   */
  function renderToCanvasWrapper(
    timelineItems: UnifiedTimelineItemData<MediaType>[],
    currentTimeN: number,
  ): void {
    // 上游仍然沿用 MediaBunny 的解码与时间推进；这里只把“最终如何画到 canvas”
    // 切换为 WebGL2 RenderChain 后端。
    // 这里保留一次直接准备路径，覆盖暂停、seek、首帧渲染和缓冲未命中时的即时渲染。
    if (!mCanvas || !mWebGLRenderer) return
    mWebGLRenderer.render(timelineItems, currentTimeN, mBunnyCurFrameMap)
  }

  // ==================== 音频系统 ====================

  /**
   * 初始化音频系统
   */
  function initializeAudioSystem(): void {
    mAudioContext = new AudioContext({
      sampleRate: AUDIO_DEFAULT_SAMPLE_RATE,
    })
    mGainNode = mAudioContext.createGain()
    mGainNode.connect(mAudioContext.destination)
    console.log(`🎧 AudioContext 已创建，采样率: ${mAudioContext.sampleRate}Hz`)
  }

  /**
   * 调度音频缓冲
   */
  function scheduleAudioBuffers(
    wrappedBuffers: WrappedAudioBuffer[],
    rate: number,
    volume: number,
  ): void {
    if (!mAudioContext || !mGainNode) return

    for (const wrapped of wrappedBuffers) {
      const node = mAudioContext.createBufferSource()
      node.buffer = wrapped.buffer // 直接使用 AudioBuffer，无需转换
      node.playbackRate.value = rate

      // 为每个音频节点创建独立的增益节点以控制音量
      const gainNode = mAudioContext.createGain()
      gainNode.gain.value = volume
      node.connect(gainNode)
      gainNode.connect(mGainNode)

      const startTimestampS = mAudioContextStartTimeS! + wrapped.timestamp - mPlaybackTimeAtStartS
      const curTimeS = mAudioContext.currentTime
      if (startTimestampS >= curTimeS) {
        node.start(startTimestampS)
      } else {
        node.start(curTimeS, curTimeS - startTimestampS)
      }
      mQueuedAudioNodes.add(node)
      node.onended = () => {
        mQueuedAudioNodes.delete(node)
      }

      // ✅ 不需要 close()，AudioBuffer 由浏览器自动管理
    }
  }

  /**
   * 停止所有音频节点
   */
  function stopAllAudioNodes(): void {
    // 已在解码的音频也会失效，避免暂停后重新排入音频节点。
    mAudioScheduleGenerationN++
    for (const node of mQueuedAudioNodes) {
      try {
        node.stop()
      } catch (_err) {
        // 忽略已停止的节点
      }
    }
    mQueuedAudioNodes.clear()
  }

  // ==================== 播放控制 ====================

  /** 恢复音频设备，控制器确认播放请求仍有效后再设定起播锚点。 */
  async function preparePlayback(): Promise<boolean> {
    const audioContext = mAudioContext
    if (!audioContext) return false

    try {
      if (audioContext.state === 'suspended') await audioContext.resume()
      return mAudioContext === audioContext
    } catch (error) {
      if (mAudioContext === audioContext) console.error('❌ 恢复预览音频失败:', error)
      return false
    }
  }

  function startPlayback(startFrameN: number): void {
    if (!mAudioContext) return
    // 起播使用控制器传来的最新帧，取消拖动时排队的预览定位。
    throttledSeekToFrame.cancel()
    mAudioContextStartTimeS = mAudioContext.currentTime
    mPlaybackTimeAtStartS = startFrameN / RENDERER_FPS

    console.log('▶️ MediaBunny 开始播放')
  }

  /** 停止音频推进，渲染循环继续显示指定帧的预览。 */
  function stopPlayback(frameN: number, clearBuffers = false): void {
    stopAllAudioNodes()
    if (clearBuffers) mBufferManager?.clearBuffers()
    mAudioContextStartTimeS = null
    mPlaybackTimeAtStartS = frameN / RENDERER_FPS
  }

  /**
   * 应用暂停态的预览目标帧。
   */
  function seekPreviewFrame(frameN: number): void {
    const clampedFrameN = Math.max(0, Math.min(mTimelineDurationN, frameN))
    stopPlayback(clampedFrameN, true)
  }

  /**
   * 更新项目时长
   * @param newDurationN 项目时长（帧数，number类型）
   */
  function updateTimelineDuration(newDurationN: number): void {
    mTimelineDurationN = newDurationN
    const durationS = newDurationN / RENDERER_FPS
    console.log(`🎯 更新项目时长: ${durationS.toFixed(2)}s ${newDurationN}帧`)
  }

  // ==================== 事件监听 ====================

  // 拖动时按 100 ms 节流定位，执行时取最新目标帧并跳过中间请求。
  // 解码由渲染循环调度，同一个 clip 正在解码时 tickN 会跳过重复请求。
  const throttledSeekToFrame = throttle(() => {
    const frameN = playback.currentFrame.value
    if (!playback.isPlaying.value && frameN !== mCurrentBunnyFrameN.value) {
      seekPreviewFrame(frameN)
    }
  }, 100)
  /**
   * 设置播放监听器
   * 暂停态按节流节奏消费播放头位置，画布和解码由渲染循环推进。
   */
  function setupPlaybackListeners(): void {
    mPlaybackListenersCleanup?.()

    // 监听时间轴时长变化，自动更新 MediaBunny 播放器时长
    const stopWatchingDuration = watch(
      contentEndTimeN,
      (newDurationN) => {
        updateTimelineDuration(newDurationN)
        console.log(`🎯 [MediaBunny] 时间轴时长变化，已更新播放器时长: ${newDurationN}帧`)
      },
      { immediate: true },
    )

    const stopWatchingFrame = watch(
      [playback.currentFrame, mCurrentBunnyFrameN],
      ([playbackFrameN, bunnyFrameN]) => {
        if (playbackFrameN !== bunnyFrameN && !playback.isPlaying.value) {
          throttledSeekToFrame()
        }
      },
      { immediate: true },
    )

    // 画布销毁或重新绑定时同时撤销监听和待执行的定位。
    mPlaybackListenersCleanup = () => {
      stopWatchingFrame()
      stopWatchingDuration()
      throttledSeekToFrame.cancel()
    }

    console.log('✅ MediaBunny 播放监听器已设置')
  }

  // ==================== 工具方法 ====================

  /**
   * 检查 MediaBunny 是否可用
   * @returns 是否可用
   */
  function isMediaBunnyAvailable(): boolean {
    return !!(mCanvas && mWebGLRenderer && isMediaBunnyReady.value && !mediaBunnyError.value)
  }

  // ==================== 截帧功能 ====================

  /** 创建独立的离屏截帧会话，构造时固定工程数据并传递取消与素材准备入口。 */
  function createFrameCaptureSession(
    options: CaptureTimelineFrameOptions = {},
  ): TimelineFrameCaptureSession {
    return new TimelineFrameCaptureSession({
      videoWidth: configModule.videoResolution.value.width,
      videoHeight: configModule.videoResolution.value.height,
      timelineItems: timelineModule.timelineItems.value,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      prepareMedia: options.prepareMedia,
      tracks: trackModule.tracks.value.map((track) => ({
        id: track.id,
        isVisible: track.isVisible,
        isMuted: track.isMuted,
      })),
      getMediaItem: (mediaItemId: string) => mediaModule.getMediaItem(mediaItemId),
    })
  }

  /**
   * 使用独立离屏渲染会话截取指定时间轴帧。
   * 不会修改当前预览画布、播放状态或播放头位置。
   */
  async function captureTimelineFrame(
    frameNumberN: number,
    options: CaptureTimelineFrameOptions = {},
  ): Promise<Blob> {
    const session = createFrameCaptureSession(options)

    try {
      return await session.captureFrame(frameNumberN, options)
    } finally {
      await session.dispose()
    }
  }

  async function captureTimelineFrames(
    frameNumbersN: number[],
    options: CaptureTimelineFrameOptions = {},
  ): Promise<Blob[]> {
    const session = createFrameCaptureSession(options)

    try {
      return await session.captureFrames(frameNumbersN, options)
    } finally {
      await session.dispose()
    }
  }

  /**
   * 截取当前播放头对应的合成画面并下载
   * @param filename 下载文件名（可选，默认为 'screenshot-时间戳.png'）
   * @returns Promise<Blob> 返回截取的 Blob 对象
   */
  async function captureCanvasFrame(filename?: string): Promise<Blob> {
    try {
      const blob = await captureTimelineFrame(playback.currentFrame.value)

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
      const defaultFilename = `screenshot-${timestamp}.png`
      const finalFilename = filename || defaultFilename

      downloadBlob(blob, finalFilename)
      console.log(`📸 画布截帧成功: ${finalFilename}`)
      return blob
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('❌ 画布截帧失败:', errorMessage)
      throw error
    }
  }

  // ==================== 导出接口 ====================

  return {
    // 状态
    isMediaBunnyReady,
    mediaBunnyError,

    // 画布管理
    setCanvas,
    destroy,

    // 播放控制
    preparePlayback,
    startPlayback,
    stopPlayback,

    // 截帧功能
    createFrameCaptureSession,
    captureTimelineFrame,
    captureTimelineFrames,
    captureCanvasFrame,

    // 工具方法
    isMediaBunnyAvailable,
  }
}

// 导出类型定义
export type UnifiedMediaBunnyModule = ReturnType<typeof createUnifiedMediaBunnyModule>
