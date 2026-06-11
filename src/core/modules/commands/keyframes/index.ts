/**
 * 关键帧命令模块入口文件
 * 统一导出所有关键帧命令类和相关工具
 * 适配新架构的统一类型系统
 */

export { ClearAllKeyframesCommand } from './ClearAllKeyframesCommand'
// 导出当前仍在使用的命令类

// 导出共享的类型和工具函数
export type {
  KeyframeSnapshot,
  TimelineModule,
  PlaybackControls,
} from './shared'

export {
  createSnapshot,
  applyKeyframeSnapshot,
  isPlayheadInTimelineItem,
  showUserWarning,
} from './shared'
