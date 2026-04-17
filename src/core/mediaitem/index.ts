/**
 * 统一媒体项目模块入口
 * 导出所有数据结构和行为函数
 */

// 导出数据结构和类型
export type {
  MediaStatus,
  MediaType,
  MediaTypeOrUnknown,
  UnifiedMediaItemData,
  UnifiedMediaItemMetadata,
  ReadyMediaItem,
  ProcessingMediaItem,
  ErrorMediaItem,
  PendingMediaItem,
  VideoMediaItem,
  ImageMediaItem,
  AudioMediaItem,
  TextMediaItem,
  UnknownMediaItem,
  KnownMediaItem,
  VisualMediaItem,
  AudioCapableMediaItem,
} from './types'

export { createUnifiedMediaItemData } from './types'
export {
  MediaVisualSummaryService,
  mediaVisualSummaryService,
} from './MediaVisualSummaryService'

// 导出查询函数
export { MediaItemQueries as MediaItemQueries } from './queries'

// 导出行为函数
export { UnifiedMediaItemActions } from './actions'
