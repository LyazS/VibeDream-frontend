/**
 * 统一项目配置模块
 * 导出项目配置相关的类型定义
 */

// 导出项目配置类型
export {
  PROJECT_FORMAT_VERSION,
  isSupportedProjectFormatVersion,
  type UnifiedProjectConfig,
  type UnifiedProjectTimeline,
} from './types'
export type {
  BaseLibraryAssetMetaFile,
  EffectTemplateLibraryAssetMetaFile,
  LibraryAssetMetaFile,
  MediaLibraryAssetMetaFile,
  MediaMetaFile,
} from './metaTypes'
export {
  isEffectTemplateLibraryAssetMetaFile,
  isEffectTemplateLibraryAssetMetaFileValue,
  isMediaLibraryAssetMetaFile,
  isMediaLibraryAssetMetaFileValue,
  parseLibraryAssetMetaFile,
} from './metaTypes'
