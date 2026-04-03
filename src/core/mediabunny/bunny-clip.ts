import { VideoSample, type AnyIterable, type WrappedAudioBuffer } from 'mediabunny'
import {
  RENDERER_FPS,
  VIDEO_SEEK_THRESHOLD,
  AUDIO_SCHEDULE_AHEAD,
  AUDIO_ANOMALY_THRESHOLD,
} from './constant'
import type { TimeRange } from './types'
import type { IClip } from './IClip'
import { BunnyMedia } from './bunny-media'
/**
 * 媒体播放器核心类 - 统一管理视频和音频播放状态
 */
export class BunnyClip implements IClip {
  private bunnyMedia: BunnyMedia
  private needResetVideo: boolean = false
  private needResetAudio: boolean = false
  private isTicking: boolean = false

  // 视频相关属性
  private videoSampleAtTSFunc:
    | ((timestamps: AnyIterable<number>) => AsyncGenerator<VideoSample | null, void, unknown>)
    | null = null
  private videoGetSampleFunc: ((timestamps: number) => Promise<VideoSample | null>) | null = null
  private videoIteratorN: AsyncGenerator<VideoSample | null, void, unknown> | null = null
  private videoInTimeN: bigint = 0n
  private nextFrameN: VideoSample | null = null

  // 音频相关属性
  private audioBufferFunc:
    | ((
        startTimestamp?: number | undefined,
        endTimestamp?: number | undefined,
      ) => AsyncGenerator<WrappedAudioBuffer, void, unknown>)
    | null = null
  private audioIterator: AsyncGenerator<WrappedAudioBuffer, void, unknown> | null = null
  private audioInTime: number = 0

  // 公开属性
  public timeRange: TimeRange = {
    clipStart: 0n,
    clipEnd: 0n,
    timelineStart: 0n,
    timelineEnd: 0n,
  }
  public previewRate: number = 1.0 // 预览倍速
  public duration: number = 0
  public durationN: bigint = 0n
  public clockwiseRotation: number = 0

  constructor(bunnyMedia: BunnyMedia) {
    this.bunnyMedia = bunnyMedia
    this.duration = bunnyMedia.duration
    this.durationN = bunnyMedia.durationN
    this.clockwiseRotation = bunnyMedia.clockwiseRotation
    this.videoSampleAtTSFunc = bunnyMedia.videoSamplesAtTimestamps()
    this.videoGetSampleFunc = bunnyMedia.videoGetSample()
    this.audioBufferFunc = bunnyMedia.audioBuffersFunc()
    this.setTimeRange({
      clipStart: 0n,
      clipEnd: this.durationN,
      timelineStart: 0n,
      timelineEnd: this.durationN,
    })
  }

  // ==================== 视频相关方法 ====================

  *generateTimestamps(startN: bigint): Generator<number> {
    const clipDuration = Number(this.timeRange.clipEnd - this.timeRange.clipStart)
    const tlDuration = Number(this.timeRange.timelineEnd - this.timeRange.timelineStart)
    const clipStart = Number(this.timeRange.clipStart)
    for (let tlN = startN; tlN < this.timeRange.timelineEnd; tlN++) {
      // 在clip上的小数帧位置
      const clipTimeN =
        (Number(tlN - this.timeRange.timelineStart) / tlDuration) * clipDuration + clipStart
      const time = clipTimeN / RENDERER_FPS
      yield time
    }
  }

  private async ensureVideoIteratorN(startN: bigint): Promise<void> {
    if (!this.videoIteratorN && this.videoSampleAtTSFunc) {
      this.videoIteratorN = this.videoSampleAtTSFunc(this.generateTimestamps(startN))
      this.nextFrameN = (await this.videoIteratorN.next()).value ?? null
      this.videoInTimeN = startN
    }
  }

  /**
   * 获取当前视频帧 - 使用 shift + 递归策略自动清理过期帧
   * @param timeN 当前播放时间
   * @returns 当前帧或null
   */
  private async findVideoFrameN(timeN: bigint): Promise<VideoSample | null> {
    // 超出时间范围直接返回 null，这样可以确保在范围之内
    if (timeN < this.timeRange.timelineStart || timeN >= this.timeRange.timelineEnd) {
      return null
    }
    if (
      this.needResetVideo ||
      !this.videoIteratorN ||
      timeN < this.videoInTimeN || // 如果是往回seek
      timeN - this.videoInTimeN > BigInt(Math.round(VIDEO_SEEK_THRESHOLD * RENDERER_FPS)) // 如果往前seek太远
    ) {
      await this.resetVideoN(timeN)
    }

    if (!this.videoIteratorN) return null

    while (true) {
      // 1. 检查 nextFrameN 是否存在
      if (!this.nextFrameN) {
        // 从迭代器获取新帧
        const sample_res = await this.videoIteratorN?.next?.()
        this.nextFrameN = sample_res?.value ?? null
        this.videoInTimeN = this.videoInTimeN + 1n
      }

      // 情况1：帧在时间点之前（过期）
      if (this.videoInTimeN < timeN) {
        this.nextFrameN?.close() // 释放过期帧
        this.nextFrameN = null // 清空缓存，下次循环会解码新帧
        continue // 继续下一个循环
      }

      // 情况2：帧在时间点之内（匹配）
      if (this.videoInTimeN === timeN) {
        const clone_frame = this.nextFrameN?.clone() ?? null
        this.nextFrameN?.close() // 释放原帧
        this.nextFrameN = null // 清空缓存，帧的所有权转移给调用者
        return clone_frame
      }

      // 情况3：帧在时间点之后（未来帧）
      // nextFrameN 保持不变，跳出循环，等待下一次调用
      console.log(`🎞️ [视频] 未来帧 - 当前: ${timeN}帧, 上次: ${this.videoInTimeN}帧`)
      return null
    }
  }

  private async resetVideoN(startN: bigint): Promise<void> {
    // 清理缓存的下一帧
    this.nextFrameN?.close()
    this.nextFrameN = null

    // 清理旧迭代器并创建新的
    await this.cleanupVideoIteratorN()
    await this.ensureVideoIteratorN(startN)
    this.needResetVideo = false
  }

  private async cleanupVideoIteratorN(): Promise<void> {
    await this.videoIteratorN?.return()
    this.videoIteratorN = null
  }

  // ==================== 音频相关方法 ====================

  /**
   * 确保音频迭代器存在 - 延迟初始化策略
   * @param startTime 迭代器起始时间，默认从0开始
   */
  private async ensureAudioIterator(startTime: number = 0): Promise<void> {
    if (!this.audioIterator && this.audioBufferFunc) {
      this.audioIterator = this.audioBufferFunc(startTime)
    }
  }

  private async findAudioBuffersN(timeN: bigint, headFrame: bigint): Promise<WrappedAudioBuffer[]> {
    // 超出时间范围直接返回 null，这样可以确保在范围之内
    if (timeN < this.timeRange.timelineStart || timeN >= this.timeRange.timelineEnd) {
      return []
    }
    // 将时间轴时间映射回 clip 时间（原始媒体时间）
    const clipDuration = Number(this.timeRange.clipEnd - this.timeRange.clipStart)
    const tlDuration = Number(this.timeRange.timelineEnd - this.timeRange.timelineStart)
    const clipStart = Number(this.timeRange.clipStart)
    const clipTimeN =
      (Number(timeN + headFrame - this.timeRange.timelineStart) / tlDuration) * clipDuration +
      clipStart
    const anomaly_th = ((AUDIO_ANOMALY_THRESHOLD * RENDERER_FPS) / tlDuration) * clipDuration
    // timeN是时间轴上的帧点
    // 这是映射到clip上的时间点
    const currentTime = clipTimeN / RENDERER_FPS
    // ✨ 检测时间异常：倒退或跳跃超过阈值
    // 音频对时间连续性要求极高，超过阈值就需要重新 seek
    if (
      this.needResetAudio ||
      !this.audioIterator ||
      currentTime < this.audioInTime ||
      currentTime - this.audioInTime > anomaly_th
    ) {
      await this.resetAudio(currentTime)
    }

    this.audioInTime = currentTime
    if (!this.audioIterator) return []
    const result: WrappedAudioBuffer[] = []
    while (1) {
      const result_buffer = await this.audioIterator.next()
      if (result_buffer.done || !result_buffer.value) {
        break
      }
      const wrappedBuffer = result_buffer.value
      result.push(wrappedBuffer)
      if (wrappedBuffer.timestamp + wrappedBuffer.duration >= currentTime) {
        break
      }
    }
    const rate = this.getPlaybackRate()
    const processedBuffers: WrappedAudioBuffer[] = []

    for (const wrapped of result) {
      // 创建新的 WrappedAudioBuffer 对象，更新时间戳
      const newTimestamp =
        (wrapped.timestamp - clipStart / RENDERER_FPS) / rate +
        Number(this.timeRange.timelineStart) / RENDERER_FPS

      processedBuffers.push({
        buffer: wrapped.buffer,
        timestamp: newTimestamp,
        duration: wrapped.duration,
      })
    }

    return processedBuffers
  }

  /**
   * Seek 音频到指定时间 - 清理并重建迭代器
   * @param timestamp 目标时间戳
   */
  private async resetAudio(timestamp: number): Promise<void> {
    // 清理旧迭代器并创建新的
    await this.cleanupAudioIterator()
    await this.ensureAudioIterator(timestamp)
    this.needResetAudio = false
  }

  /**
   * 清理音频迭代器
   */
  private async cleanupAudioIterator(): Promise<void> {
    await this.audioIterator?.return()
    this.audioIterator = null
  }

  /**
   * 准备方法 - 重置视频和音频到时间轴起始位置
   */
  async prepare(): Promise<void> {
    // 重置视频到 timelineStart
    await this.resetVideoN(this.timeRange.timelineStart)

    // 重置音频到 timelineStart（使用 findAudioBuffersN 的计算逻辑）
    const clipDuration = Number(this.timeRange.clipEnd - this.timeRange.clipStart)
    const tlDuration = Number(this.timeRange.timelineEnd - this.timeRange.timelineStart)
    const clipStart = Number(this.timeRange.clipStart)
    const clipTimeN =
      (Number(this.timeRange.timelineStart - this.timeRange.timelineStart) / tlDuration) *
        clipDuration +
      clipStart
    const currentTime = clipTimeN / RENDERER_FPS
    await this.resetAudio(currentTime)
  }

  // ==================== 公共接口 ====================
  setTimeRange(timeRange: Partial<TimeRange>): void {
    // 计算新的时间范围值
    const newClipStart = timeRange.clipStart ?? this.timeRange.clipStart
    const newClipEnd = timeRange.clipEnd ?? this.timeRange.clipEnd
    const newTimelineStart = timeRange.timelineStart ?? this.timeRange.timelineStart
    const newTimelineEnd = timeRange.timelineEnd ?? this.timeRange.timelineEnd

    // 验证 clipStart 必须大于等于 0
    if (newClipStart < 0n) {
      throw new Error(`clipStart 必须大于等于 0，当前值: ${newClipStart}`)
    }

    // 验证 clipEnd 必须小于等于 durationN
    if (newClipEnd > this.durationN) {
      throw new Error(`clipEnd 必须小于等于 ${this.durationN}，当前值: ${newClipEnd}`)
    }

    // 验证 clipEnd 必须大于等于 clipStart
    if (newClipEnd < newClipStart) {
      throw new Error(`clipEnd (${newClipEnd}) 必须大于等于 clipStart (${newClipStart})`)
    }

    // 验证 timelineEnd 必须大于等于 timelineStart
    if (newTimelineEnd < newTimelineStart) {
      throw new Error(
        `timelineEnd (${newTimelineEnd}) 必须大于等于 timelineStart (${newTimelineStart})`,
      )
    }

    // 所有验证通过，更新时间范围
    this.timeRange = {
      clipStart: newClipStart,
      clipEnd: newClipEnd,
      timelineStart: newTimelineStart,
      timelineEnd: newTimelineEnd,
    }
    this.needResetVideo = true
    this.needResetAudio = true
  }

  getPlaybackRate(): number {
    const rate =
      Number(this.timeRange.clipEnd - this.timeRange.clipStart) /
      Number(this.timeRange.timelineEnd - this.timeRange.timelineStart)
    return rate
  }
  async setPreviewRate(rate: number): Promise<void> {
    this.previewRate = rate
  }

  tickInterceptor: <T>(time: number | bigint, result: T) => Promise<T> = async (_, result) => result

  /**
   * 播放时获取指定时间点的音视频帧
   * @param timeN 时间轴上的帧位置
   * @returns 包含音频样本数组、视频帧和状态
   */
  async tickN(
    timeN: bigint,
    needAudio: boolean = true,
    needVideo: boolean = true,
    audioHeadFrame?: bigint,
  ): Promise<{
    audio: WrappedAudioBuffer[]
    video: VideoSample | null
    state: 'success' | 'outofrange' | 'skip'
  }> {
    if (this.isTicking) {
      return this.tickInterceptor(timeN, {
        audio: [],
        video: null,
        state: 'skip',
      })
    }
    try {
      this.isTicking = true
      if (timeN < this.timeRange.timelineStart || timeN >= this.timeRange.timelineEnd) {
        return this.tickInterceptor(timeN, {
          audio: [],
          video: null,
          state: 'outofrange',
        })
      }
      if (audioHeadFrame === null || audioHeadFrame === undefined)
        audioHeadFrame = BigInt(Math.round(AUDIO_SCHEDULE_AHEAD * RENDERER_FPS))
      const [audio, video] = await Promise.all([
        this.audioBufferFunc && needAudio ? this.findAudioBuffersN(timeN, audioHeadFrame) : [],
        this.videoSampleAtTSFunc && needVideo ? this.findVideoFrameN(timeN) : null,
      ])
      return await this.tickInterceptor(timeN, {
        audio,
        video,
        state: 'success',
      })
    } finally {
      this.isTicking = false
    }
  }

  /**
   * 获取指定时间点的视频帧（仅视频，不含音频）
   * @param clipTimeN Clip上的帧位置
   * @returns 包含视频帧和状态，音频数组始终为空
   */
  async getSampleN(clipTimeN: bigint): Promise<{
    audio: WrappedAudioBuffer[]
    video: VideoSample | null
    state: 'success' | 'outofrange'
  }> {
    if (clipTimeN < 0n || this.durationN < clipTimeN) {
      return this.tickInterceptor(clipTimeN, {
        audio: [],
        video: null,
        state: 'outofrange',
      })
    }
    const video = (await this.videoGetSampleFunc?.(Number(clipTimeN) / RENDERER_FPS)) ?? null
    return await this.tickInterceptor(clipTimeN, {
      audio: [],
      video,
      state: 'success',
    })
  }

  /**
   * 批量生成缩略图的异步迭代器，用于时间轴缩略图显示
   * @param clipTimeNs 时间点数组（帧位置）
   * @yields 每次返回 { frame: VideoFrame | null, state: boolean }
   */
  async *thumbnailIter(
    clipTimeNs: bigint[],
  ): AsyncGenerator<{ frame: VideoFrame | null; state: boolean }, void, unknown> {
    if (this.videoSampleAtTSFunc) {
      const timeIter = clipTimeNs.map((n) => Number(n) / RENDERER_FPS)[Symbol.iterator]()
      for await (const sample of this.videoSampleAtTSFunc(timeIter)) {
        const frame = sample?.toVideoFrame() ?? null
        sample?.close()
        yield { frame, state: true }
      }
    } else {
      yield { frame: null, state: false }
    }
  }

  /**
   * 克隆当前 Clip 实例
   * @returns 克隆后的新 Clip 实例
   */
  clone(): BunnyClip {
    const newClip = new BunnyClip(this.bunnyMedia)
    newClip.setTimeRange(this.timeRange)
    return newClip
  }

  /**
   * 释放所有资源
   */
  async dispose(): Promise<void> {
    console.log('🧹 清理 BunnyClip 资源')

    // 清理视频相关资源
    this.nextFrameN?.close() // 释放缓存的视频帧
    this.nextFrameN = null
    await this.cleanupVideoIteratorN() // 清理视频迭代器

    // 清理音频相关资源
    await this.cleanupAudioIterator() // 等待音频迭代器清理完成

    console.log('✅ BunnyClip 资源清理完成')
  }
}
