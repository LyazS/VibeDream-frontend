/**
 * 关键帧命令模块入口文件
 * 统一导出所有关键帧命令类和相关工具
 * 适配新架构的统一类型系统
 */

// 导出所有命令类
export { CreateKeyframeCommand } from './CreateKeyframeCommand'
export { DeleteKeyframeCommand } from './DeleteKeyframeCommand'
export { UpdatePropertyCommand } from './UpdatePropertyCommand'
export { UpdateMaskCommand } from './UpdateMaskCommand'
export { ClearAllKeyframesCommand } from './ClearAllKeyframesCommand'
export { SetAnimationGroupValueCommand } from './SetAnimationGroupValueCommand'
export { ToggleAnimationGroupKeyframeCommand } from './ToggleAnimationGroupKeyframeCommand'
export { BatchSetAnimationGroupValuesCommand } from './BatchSetAnimationGroupValuesCommand'

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
