/**
 * 播放状态
 */
export interface PlaybackState {
  isPlaying: boolean
  currentTime: number
  duration: number
  currentTimeN: bigint
  durationN: bigint
}

export interface TimeRange {
  // 帧数为单位，RENDERER_FPS是帧率
  clipStart: bigint
  // 右开区间 end，不包含该帧
  clipEnd: bigint
  timelineStart: bigint
  // 右开区间 end，不包含该帧
  timelineEnd: bigint
}
