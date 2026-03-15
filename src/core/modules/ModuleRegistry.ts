// 导入模块类型定义（这些会在后续步骤中创建或修改）
import type { UnifiedConfigModule } from './UnifiedConfigModule'
import type { UnifiedMediaModule } from './UnifiedMediaModule'
import type { UnifiedTrackModule } from './UnifiedTrackModule'
import type { UnifiedPlaybackModule } from './UnifiedPlaybackModule'
import type { UnifiedTimelineModule } from './UnifiedTimelineModule'
import type { UnifiedViewportModule } from './UnifiedViewportModule'
import type { UnifiedProjectModule } from './UnifiedProjectModule'
import type { UnifiedUseNaiveUIModule } from './UnifiedUseNaiveUIModule'
import type { UnifiedHistoryModule } from './UnifiedHistoryModule'
import type { UnifiedSelectionModule } from './UnifiedSelectionModule'
import type { UnifiedAutoSaveModule } from './UnifiedAutoSaveModule'
import type { UnifiedVideoThumbnailModule } from './UnifiedVideoThumbnailModule'
import type { UnifiedSnapModule } from './UnifiedSnapModule'
import type { UnifiedUserModule } from './UnifiedUserModule'
import type { UnifiedDirectoryModule } from './UnifiedDirectoryModule'
import type { UnifiedMediaBunnyModule } from './UnifiedMediaBunnyModule'
import type { UnifiedUIModule } from './UnifiedUIModule'
// 模块名称常量
export const MODULE_NAMES = {
  CONFIG: 'config',
  MEDIA: 'media',
  TRACK: 'track',
  PLAYBACK: 'playback',
  TIMELINE: 'timeline',
  VIEWPORT: 'viewport',
  PROJECT: 'project',
  USENAIVEUI: 'usenaiveui',
  HISTORY: 'history',
  SELECTION: 'selection',
  AUTOSAVE: 'autosave',
  VIDEOTHUMBNAIL: 'videothumbnail',
  SNAP: 'snap',
  USER: 'user',
  DIRECTORY: 'directory',
  MEDIABUNNY: 'mediabunny',
  UI: 'ui',
} as const

// 模块类型映射
export type ModuleMap = {
  [MODULE_NAMES.CONFIG]: UnifiedConfigModule
  [MODULE_NAMES.MEDIA]: UnifiedMediaModule
  [MODULE_NAMES.TRACK]: UnifiedTrackModule
  [MODULE_NAMES.PLAYBACK]: UnifiedPlaybackModule
  [MODULE_NAMES.TIMELINE]: UnifiedTimelineModule
  [MODULE_NAMES.VIEWPORT]: UnifiedViewportModule
  [MODULE_NAMES.PROJECT]: UnifiedProjectModule
  [MODULE_NAMES.USENAIVEUI]: UnifiedUseNaiveUIModule
  [MODULE_NAMES.HISTORY]: UnifiedHistoryModule
  [MODULE_NAMES.SELECTION]: UnifiedSelectionModule
  [MODULE_NAMES.AUTOSAVE]: UnifiedAutoSaveModule
  [MODULE_NAMES.VIDEOTHUMBNAIL]: UnifiedVideoThumbnailModule
  [MODULE_NAMES.SNAP]: UnifiedSnapModule
  [MODULE_NAMES.USER]: UnifiedUserModule
  [MODULE_NAMES.DIRECTORY]: UnifiedDirectoryModule
  [MODULE_NAMES.MEDIABUNNY]: UnifiedMediaBunnyModule
  [MODULE_NAMES.UI]: UnifiedUIModule
}

/**
 * 模块注册中心
 * 负责管理所有模块实例的注册和获取
 */
export class ModuleRegistry {
  private modules = new Map<string, unknown>()

  // 注册模块
  register<T>(name: string, module: T): void {
    this.modules.set(name, module)
  }

  // 获取模块
  get<T>(name: string): T {
    const module = this.modules.get(name)
    if (!module) {
      throw new Error(`Module '${name}' not found in registry`)
    }
    return module as T
  }
}
