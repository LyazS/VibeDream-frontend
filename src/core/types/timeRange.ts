export interface UnifiedTimeRange {
  /** 时间轴开始时间（帧数） - 在整个项目时间轴上的开始位置 */
  timelineStartTime: number
  /** 时间轴结束时间（帧数，右开） - 在整个项目时间轴上的结束位置 */
  timelineEndTime: number
  /** 素材内部开始时间（帧数） - 从素材的哪个帧开始播放 */
  clipStartTime: number
  /** 素材内部结束时间（帧数，右开） - 播放到素材的哪个帧结束 */
  clipEndTime: number
}
