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
  REMOTE_TASK_SUBMITTED_RESOURCE_TYPE,
  REMOTE_TASK_COMPLETED_RESOURCE_TYPE,
  AIGeneratedMediaResolver,
  RemoteTaskSubmittedResolver,
  RemoteTaskCompletedResolver,
  createAIGeneratedMediaRequest,
  createAIGeneratedMediaResolver,
  createRemoteTaskSubmittedRequest,
  createRemoteTaskSubmittedResolver,
  createRemoteTaskCompletedRequest,
  createRemoteTaskCompletedResolver,
  isAIGeneratedMediaItem,
  isAIGeneratedMediaRecoverable,
  resetAIGeneratedMediaForRetry,
  type AIGeneratedMediaInput,
  type AIGeneratedMediaProvider,
  type AIGeneratedMediaResult,
  type RemoteTaskSubmittedInput,
  type RemoteTaskSubmittedResult,
  type RemoteTaskCompletedInput,
  type RemoteTaskCompletedResult,
} from './resolvers/AIGeneratedMediaResolver'
export {
  TIMELINE_ITEM_READY_RESOURCE_TYPE,
  TimelineItemReadyResolver,
  createTimelineItemReadyRequest,
  createTimelineItemReadyResolver,
  type TimelineItemReadyInput,
  type TimelineItemReadyResult,
} from './resolvers/TimelineItemReadyResolver'
