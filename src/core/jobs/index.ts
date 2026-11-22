/**
 * jobs 模块统一出口。
 *
 * 业务接入时优先从这里导入 Runtime、类型和便捷 resolver，避免依赖内部文件路径。
 */
export { DagScheduler, type DagSchedulerOptions } from './DagScheduler'
export { createJobRuntime, JobRuntime, type JobRuntimeOptions } from './JobRuntime'
export {
  ResourceResolverRegistry,
  type ResolveCheckContext,
  type ResolveContext,
  type ResourceResolver,
} from './ResourceResolver'
export {
  createResourceNode,
  getResourceId,
  isTerminalResourceStatus,
  mergeResourcePolicy,
  type ResourceDomainEvent,
  type ResourceError,
  type ResourceEvent,
  type ResourceNode,
  type ResourcePolicy,
  type ResourceQueue,
  type ResourceRequest,
  type ResourceStatus,
  type ResourceType,
} from './ResourceTypes'
export { createTaskView, createTaskViews, type TaskView } from './TaskViewAdapter'
export { useJobTaskCenter } from './useJobTaskCenter'
export {
  FunctionResourceResolver,
  type FunctionResourceResolverOptions,
} from './resolvers/FunctionResourceResolver'
export {
  MEDIA_READY_RESOURCE_TYPE,
  MediaReadyResolver,
  createMediaReadyRequest,
  createMediaReadyResolver,
  type MediaReadyInput,
  type MediaReadyResult,
} from './resolvers/MediaReadyResolver'
export {
  MUSIC_STRUCTURE_ANALYSIS_RESOURCE_TYPE,
  MusicStructureAnalysisResolver,
  createMusicStructureAnalysisRequest,
  createMusicStructureAnalysisResolver,
  type MusicStructureAnalysisInput,
  type MusicStructureAnalysisResult,
} from './resolvers/MusicStructureAnalysisResolver'

export {
  canResumeMediaIndexingFromRemote,
  createVideoSceneSegmentsRequest,
  createVideoSegmentExportsRequest,
  createVideoSegmentOssUploadsRequest,
  createMediaIndexTaskSubmitRequest,
  createMediaIndexTaskCompleteRequest,
  createMediaIndexMetadataWritebackRequest,
  MEDIA_INDEX_METADATA_WRITEBACK_RESOURCE_TYPE,
  MEDIA_INDEX_TASK_COMPLETE_RESOURCE_TYPE,
  MEDIA_INDEX_TASK_SUBMIT_RESOURCE_TYPE,
  VIDEO_SCENE_SEGMENTS_RESOURCE_TYPE,
  VIDEO_SEGMENT_EXPORTS_RESOURCE_TYPE,
  VIDEO_SEGMENT_OSS_UPLOADS_RESOURCE_TYPE,
  setIndexingMetadata,
  shouldRecoverMediaIndexing,
  persistMediaItem,
  type MediaIndexMetadataWritebackInput,
  type MediaIndexMetadataWritebackResult,
  type MediaIndexTaskCompleteInput,
  type MediaIndexTaskCompleteResult,
  type MediaIndexTaskSubmitInput,
  type MediaIndexTaskSubmitResult,
  type MediaIndexingResult,
  type VideoSceneSegment,
  type VideoSceneSegmentsInput,
  type VideoSceneSegmentsResult,
  type VideoSegmentExportsInput,
  type VideoSegmentExportsResult,
  type VideoSegmentOssUploadsInput,
  type VideoSegmentOssUploadsResult,
} from './resolvers/mediaIndexingShared'
export {
  VideoSceneSegmentsResolver,
  createVideoSceneSegmentsResolver,
} from './resolvers/VideoSceneSegmentsResolver'
export {
  VideoSegmentExportsResolver,
  createVideoSegmentExportsResolver,
} from './resolvers/VideoSegmentExportsResolver'
export {
  VideoSegmentOssUploadsResolver,
  createVideoSegmentOssUploadsResolver,
} from './resolvers/VideoSegmentOssUploadsResolver'
export {
  MediaIndexTaskSubmitResolver,
  createMediaIndexTaskSubmitResolver,
} from './resolvers/MediaIndexTaskSubmitResolver'
export {
  MediaIndexTaskCompleteResolver,
  createMediaIndexTaskCompleteResolver,
} from './resolvers/MediaIndexTaskCompleteResolver'
export {
  MediaIndexMetadataWritebackResolver,
  createMediaIndexMetadataWritebackResolver,
} from './resolvers/MediaIndexMetadataWritebackResolver'
export {
  MEDIA_FILE_AVAILABLE_RESOURCE_TYPE,
  MediaFileAvailableResolver,
  createMediaFileAvailableRequest,
  createMediaFileAvailableResolver,
  type MediaFileAvailableInput,
  type MediaFileAvailableResult,
} from './resolvers/MediaFileAvailableResolver'
export {
  MEDIA_DECODED_RESOURCE_TYPE,
  MediaDecodedResolver,
  createMediaDecodedRequest,
  createMediaDecodedResolver,
  type MediaDecodedInput,
  type MediaDecodedResult,
} from './resolvers/MediaDecodedResolver'
export {
  MEDIA_SOURCE_PROCESSED_RESOURCE_TYPE,
  MediaSourceProcessedResolver,
  createMediaSourceProcessedRequest,
  createMediaSourceProcessedResolver,
  type MediaSourceProcessedInput,
  type MediaSourceProcessedResult,
} from './resolvers/MediaSourceProcessedResolver'

export {
  TIMELINE_ITEM_READY_RESOURCE_TYPE,
  TimelineItemReadyResolver,
  createTimelineItemReadyRequest,
  createTimelineItemReadyResolver,
  type TimelineItemReadyInput,
  type TimelineItemReadyResult,
} from './resolvers/TimelineItemReadyResolver'
export {
  EFFECT_TEMPLATE_READY_RESOURCE_TYPE,
  EffectTemplateReadyResolver,
  createEffectTemplateReadyRequest,
  createEffectTemplateReadyResolver,
  type EffectTemplateReadyInput,
  type EffectTemplateReadyResult,
} from './resolvers/EffectTemplateReadyResolver'
