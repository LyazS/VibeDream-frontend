/**
 * 统一模块系统导出
 * 提供基于新架构统一类型的模块功能
 */

// ==================== 统一轨道模块 ====================
export { createUnifiedTrackModule, type UnifiedTrackModule } from './UnifiedTrackModule'

// ==================== 统一媒体模块 ====================
export { createUnifiedMediaModule, type UnifiedMediaModule } from './UnifiedMediaModule'

// ==================== 统一时间轴模块 ====================
export { createUnifiedTimelineModule, type UnifiedTimelineModule } from './UnifiedTimelineModule'

// ==================== 统一项目模块 ====================
export { createUnifiedProjectModule, type UnifiedProjectModule } from './UnifiedProjectModule'

// ==================== 统一视口模块 ====================
export { createUnifiedViewportModule, type UnifiedViewportModule } from './UnifiedViewportModule'

// ==================== 统一选择模块 ====================
export { createUnifiedSelectionModule, type UnifiedSelectionModule } from './UnifiedSelectionModule'

// ==================== 统一配置模块 ====================
export { createUnifiedConfigModule, type UnifiedConfigModule } from './UnifiedConfigModule'

// ==================== 统一历史记录模块 ====================
export {
  createUnifiedHistoryModule,
  BaseBatchCommand,
  BatchBuilder,
  GenericBatchCommand,
  type UnifiedHistoryModule,
} from './UnifiedHistoryModule'

// ==================== 统一通知模块 ====================
export {
  createUnifiedUseNaiveUIModule,
  type UnifiedUseNaiveUIModule,
} from './UnifiedUseNaiveUIModule'

// ==================== 统一播放控制模块 ====================
export { createUnifiedPlaybackModule, type UnifiedPlaybackModule } from './UnifiedPlaybackModule'

// ==================== 统一视频缩略图模块 ====================
export {
  createUnifiedVideoThumbnailModule,
  type UnifiedVideoThumbnailModule,
} from './UnifiedVideoThumbnailModule'

// ==================== 统一自动保存模块 ====================
export { createUnifiedAutoSaveModule, type UnifiedAutoSaveModule } from './UnifiedAutoSaveModule'

// ==================== 统一吸附模块 ====================
export { createUnifiedSnapModule, type UnifiedSnapModule } from './UnifiedSnapModule'

export { createUnifiedAgentModule, type UnifiedAgentModule } from './UnifiedAgentModule'
