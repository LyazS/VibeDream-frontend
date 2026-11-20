import { ref, computed } from 'vue'
import { alignFramesToFrame, framesToTimecode } from '@/core/utils/timeUtils'
import { ModuleRegistry, MODULE_NAMES } from '@/core/modules/ModuleRegistry'
import type { UnifiedMediaBunnyModule } from '@/core/modules/UnifiedMediaBunnyModule'

/**
 * 播放控制管理模块
 * 统一更新播放头位置和播放状态，对外提供只读状态与播放命令。
 * 播放时根据 MediaBunny 上报的时钟帧推进播放头，播完后在这里收尾。
 */
export function createUnifiedPlaybackModule(registry: ModuleRegistry) {
  // ==================== 状态定义 ====================

  // 播放相关状态
  const currentFrame = ref(0) // 当前UI播放帧数（整数）
  const isPlaying = ref(false) // 是否正在播放
  const playbackRate = ref(1) // 播放速度倍率
  // 播放请求序号。开始准备播放或调用 pauseAtFrame() 时递增。
  // 等待音频设备就绪后核对序号，防止过期请求重新启动播放。
  let playRequestN = 0

  // ==================== 计算属性 ====================

  /**
   * 格式化当前时间为时间码格式
   */
  const formattedCurrentTime = computed(() => {
    return framesToTimecode(currentFrame.value)
  })

  /**
   * 播放速度的显示文本
   */
  const playbackRateText = computed(() => {
    // 使用容差来处理浮点数精度问题，避免显示1.00x快速
    const tolerance = 0.001
    const rate = playbackRate.value

    if (Math.abs(rate - 1) <= tolerance) {
      return '正常速度'
    } else if (rate < 1 - tolerance) {
      return `${rate.toFixed(1)}x 慢速`
    } else {
      return `${rate.toFixed(1)}x 快速`
    }
  })

  // ==================== 播放控制方法 ====================

  /**
   * 同步更新播放头帧号，供用户定位、播放推进和暂停使用。
   * 暂停时由 MediaBunny 监听帧号变化，节流调度解码和画布预览。
   */
  function seekToFrame(frameN: number): void {
    currentFrame.value = Math.max(0, alignFramesToFrame(frameN))
  }

  /**
   * 设置播放状态
   * @param playing 是否播放
   */
  function setPlaying(playing: boolean) {
    if (isPlaying.value !== playing) {
      isPlaying.value = playing
      console.log('▶️ 设置播放状态:', playing ? '播放' : '暂停')
    }
  }

  /**
   * 等待音频设备就绪后，从此时最新的播放头位置开始播放。
   */
  async function play(): Promise<void> {
    const mediabunny = registry.get<UnifiedMediaBunnyModule>(MODULE_NAMES.MEDIABUNNY)
    if (isPlaying.value || !mediabunny.isMediaBunnyAvailable()) return

    const requestN = ++playRequestN
    const ready = await mediabunny.preparePlayback()
    if (!ready || requestN !== playRequestN || !mediabunny.isMediaBunnyAvailable()) return

    mediabunny.startPlayback(currentFrame.value)
    setPlaying(true)
  }

  /** 暂停、停止和自然播完都在这里更新播放头并清理音频，画布继续预览指定帧。 */
  function pauseAtFrame(frameN: number, clearBuffers = false): void {
    // 暂停、停止和播完都会取消尚在等待 AudioContext 恢复的播放请求。
    playRequestN++
    setPlaying(false)
    seekToFrame(frameN)
    const mediabunny = registry.get<UnifiedMediaBunnyModule>(MODULE_NAMES.MEDIABUNNY)
    mediabunny.stopPlayback(currentFrame.value, clearBuffers)
  }

  function onPreviewFrame(frameN: number): void {
    if (isPlaying.value) seekToFrame(frameN)
  }

  /** 自然播完时停在时间轴末尾，并复用手动暂停的清理流程。 */
  function onPreviewEnded(endFrameN: number): void {
    if (isPlaying.value) pauseAtFrame(endFrameN)
  }

  /**
   * 暂停
   */
  async function pause(): Promise<void> {
    pauseAtFrame(currentFrame.value)
  }

  /**
   * 切换播放/暂停状态
   */
  function togglePlayPause(): Promise<void> {
    return isPlaying.value ? pause() : play()
  }

  /**
   * 停止播放并回到开始
   */
  async function stop(): Promise<void> {
    pauseAtFrame(0, true)
    console.log('⏹️ 停止播放')
  }

  /**
   * 设置播放速度
   * @param rate 播放速度倍率
   */
  function setPlaybackRate(rate: number) {
    // 限制播放速度在合理范围内
    const clampedRate = Math.max(0.1, Math.min(10, rate))

    if (playbackRate.value !== clampedRate) {
      const oldRate = playbackRate.value
      playbackRate.value = clampedRate
      console.log('🏃 设置播放速度:', {
        requestedRate: rate,
        oldRate,
        newRate: clampedRate,
        clamped: rate !== clampedRate,
      })
    }
  }

  /**
   * 重置播放速度为正常
   */
  function resetPlaybackRate() {
    setPlaybackRate(1)
    console.log('🔄 重置播放速度为正常')
  }

  /**
   * 重置播放状态为默认值
   */
  function resetToDefaults() {
    pauseAtFrame(0, true)
    playbackRate.value = 1
    console.log('🔄 播放状态已重置为默认值')
  }

  // ==================== 导出接口 ====================

  return {
    // 状态
    currentFrame: computed(() => currentFrame.value),
    isPlaying: computed(() => isPlaying.value),
    playbackRate,

    // 计算属性
    formattedCurrentTime,
    playbackRateText,

    // 帧数控制方法
    seekToFrame,

    // 播放控制方法
    play,
    pause,
    togglePlayPause,
    stop,
    setPlaybackRate,
    resetPlaybackRate,
    resetToDefaults,

    // 预览引擎事件，由 store 在装配时绑定。
    onPreviewFrame,
    onPreviewEnded,
  }
}

// 导出类型定义
export type UnifiedPlaybackModule = ReturnType<typeof createUnifiedPlaybackModule>
