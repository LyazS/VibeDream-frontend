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
  AI_GENERATED_MEDIA_RESOURCE_TYPE,
  AI_INPUT_PREPARED_RESOURCE_TYPE,
  AI_TASK_SUBMITTED_RESOURCE_TYPE,
  REMOTE_TASK_COMPLETED_RESOURCE_TYPE,
  AIGeneratedMediaResolver,
  AIInputPreparedResolver,
  AITaskSubmittedResolver,
  RemoteTaskCompletedResolver,
  createAIGeneratedMediaRequest,
  createAIGeneratedMediaResolver,
  createAIInputPreparedRequest,
  createAIInputPreparedResolver,
  createAITaskSubmittedRequest,
  createAITaskSubmittedResolver,
  createRemoteTaskCompletedRequest,
  createRemoteTaskCompletedResolver,
  isAIGeneratedMediaItem,
  isAIGeneratedMediaRecoverable,
  resetAIGeneratedMediaForRetry,
  type AIGeneratedMediaInput,
  type AIGeneratedMediaProvider,
  type AIGeneratedMediaResult,
  type AIInputPreparedInput,
  type AIInputPreparedResult,
  type RemoteTaskSubmittedInput,
  type RemoteTaskSubmittedResult,
  type RemoteTaskCompletedInput,
  type RemoteTaskCompletedResult,
} from './resolvers/AIGeneratedMediaResolver'
export {
  ASR_SUBTITLES_RESOURCE_TYPE,
  ASR_REMOTE_TASK_COMPLETED_RESOURCE_TYPE,
  ASRSubtitlesResolver,
  ASRRemoteTaskCompletedResolver,
  createASRSubtitlesRequest,
  createASRSubtitlesResolver,
  createASRRemoteTaskCompletedRequest,
  createASRRemoteTaskCompletedResolver,
  submitASRTask,
  type ASRSubtitlesInput,
  type ASRSubtitlesResult,
  type ASRRemoteTaskCompletedInput,
  type ASRRemoteTaskCompletedResult,
  type ASRTaskSubmitResponse,
} from './resolvers/ASRSubtitlesResolver'
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
