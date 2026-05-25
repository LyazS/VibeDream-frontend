import { defineStore } from 'pinia'
import { createUnifiedMediaModule } from '@/core/modules/UnifiedMediaModule'
import { createUnifiedTrackModule } from '@/core/modules/UnifiedTrackModule'
import { createUnifiedTimelineModule } from '@/core/modules/UnifiedTimelineModule'
import { createUnifiedProjectModule } from '@/core/modules/UnifiedProjectModule'
import { createUnifiedViewportModule } from '@/core/modules/UnifiedViewportModule'
import { createUnifiedSelectionModule } from '@/core/modules/UnifiedSelectionModule'
import { createUnifiedConfigModule } from '@/core/modules/UnifiedConfigModule'
import { createUnifiedPlaybackModule } from '@/core/modules/UnifiedPlaybackModule'
import { createUnifiedUseNaiveUIModule } from '@/core/modules/UnifiedUseNaiveUIModule'
import { createUnifiedHistoryModule } from '@/core/modules/UnifiedHistoryModule'
import { createUnifiedAutoSaveModule } from '@/core/modules/UnifiedAutoSaveModule'
import { createUnifiedVideoThumbnailModule } from '@/core/modules/UnifiedVideoThumbnailModule'
import { createUnifiedSnapModule } from '@/core/modules/UnifiedSnapModule'
import { createUnifiedUserModule } from '@/core/modules/UnifiedUserModule'
import { createUnifiedDirectoryModule } from '@/core/modules/UnifiedDirectoryModule'
import { createUnifiedMediaBunnyModule } from '@/core/modules/UnifiedMediaBunnyModule'
import { createUnifiedUIModule } from '@/core/modules/UnifiedUIModule'
import {
  createAIGeneratedMediaRequest,
  createAIGeneratedMediaResolver,
  createAIInputPreparedResolver,
  createAITaskSubmittedResolver,
  createASRRemoteTaskCompletedResolver,
  createASRSubtitlesRequest,
  createASRSubtitlesResolver,
  createEffectTemplateReadyRequest,
  createEffectTemplateReadyResolver,
  getResourceId,
  createJobRuntime,
  createMediaDecodedResolver,
  createMediaFileAvailableResolver,
  createMediaReadyRequest,
  createMediaReadyResolver,
  createMediaSourceProcessedResolver,
  createRemoteTaskCompletedResolver,
  createTimelineItemReadyRequest,
  createTimelineItemReadyResolver,
  useJobTaskCenter,
} from '@/core/jobs'
import { ModuleRegistry, MODULE_NAMES } from '@/core/modules/ModuleRegistry'
import { useHistoryOperations } from '@/core/composables/useHistoryOperations'
import { useUnifiedDrag } from '@/core/composables/useUnifiedDrag'
import type { UnifiedTimelineItemData } from '@/core/timelineitem'
import { frameToPixel, pixelToFrame } from '@/core/utils/timelineScaleUtils'
import {
  getTimelineItemsByTrack,
  isPlayheadInTimelineItem,
  findOverlappingTimelineItems,
} from '@/core/utils/timelineSearchUtils'

/**
 * 统一视频编辑器存储
 * 基于新的统一类型系统重构的主要状态管理
 *
 * 架构特点：
 * 1. 使用模块注册中心模式管理所有模块依赖
 * 2. 采用"先创建后注册"模式解决循环依赖问题
 * 3. 各模块通过注册中心动态获取依赖
 * 4. 保持模块化设计，各模块职责清晰
 * 5. 提供完整的视频编辑功能支持
 */
export const useUnifiedStore = defineStore('unified', () => {
  // ==================== 模块注册中心初始化 ====================

  // 创建模块注册中心
  const registry = new ModuleRegistry()

  // ==================== 分阶段模块创建和注册 ====================

  // 阶段1: 创建基础模块（无依赖或只有配置依赖）
  const unifiedConfigModule = createUnifiedConfigModule()
  registry.register(MODULE_NAMES.CONFIG, unifiedConfigModule)

  const unifiedPlaybackModule = createUnifiedPlaybackModule(registry)
  registry.register(MODULE_NAMES.PLAYBACK, unifiedPlaybackModule)

  const unifiedMediaModule = createUnifiedMediaModule(registry)
  registry.register(MODULE_NAMES.MEDIA, unifiedMediaModule)

  const unifiedTrackModule = createUnifiedTrackModule(registry)
  registry.register(MODULE_NAMES.TRACK, unifiedTrackModule)

  const unifiedUseNaiveUIModule = createUnifiedUseNaiveUIModule()
  registry.register(MODULE_NAMES.USENAIVEUI, unifiedUseNaiveUIModule)

  const unifiedDirectoryModule = createUnifiedDirectoryModule(registry)
  registry.register(MODULE_NAMES.DIRECTORY, unifiedDirectoryModule)

  // 阶段2: 创建需要依赖的模块
  const unifiedTimelineModule = createUnifiedTimelineModule(registry)
  registry.register(MODULE_NAMES.TIMELINE, unifiedTimelineModule)

  const unifiedProjectModule = createUnifiedProjectModule(registry)
  registry.register(MODULE_NAMES.PROJECT, unifiedProjectModule)

  const unifiedViewportModule = createUnifiedViewportModule(registry)
  registry.register(MODULE_NAMES.VIEWPORT, unifiedViewportModule)

  const unifiedHistoryModule = createUnifiedHistoryModule(registry)
  registry.register(MODULE_NAMES.HISTORY, unifiedHistoryModule)

  const unifiedSelectionModule = createUnifiedSelectionModule(registry)
  registry.register(MODULE_NAMES.SELECTION, unifiedSelectionModule)

  const unifiedAutoSaveModule = createUnifiedAutoSaveModule(registry, {
    enabled: true,
    debounceTime: 2000,
    throttleTime: 30000,
    maxRetries: 3,
  })
  registry.register(MODULE_NAMES.AUTOSAVE, unifiedAutoSaveModule)

  const unifiedVideoThumbnailModule = createUnifiedVideoThumbnailModule(registry)
  registry.register(MODULE_NAMES.VIDEOTHUMBNAIL, unifiedVideoThumbnailModule)

  const unifiedSnapModule = createUnifiedSnapModule(registry)
  registry.register(MODULE_NAMES.SNAP, unifiedSnapModule)

  const unifiedUserModule = createUnifiedUserModule(registry)
  registry.register(MODULE_NAMES.USER, unifiedUserModule)

  const unifiedMediaBunnyModule = createUnifiedMediaBunnyModule(registry, unifiedViewportModule.contentEndTimeFrames)
  registry.register(MODULE_NAMES.MEDIABUNNY, unifiedMediaBunnyModule)

  const unifiedUIModule = createUnifiedUIModule(registry)
  registry.register(MODULE_NAMES.UI, unifiedUIModule)

  const jobRuntime = createJobRuntime()
  jobRuntime.registerResolver(createMediaFileAvailableResolver(unifiedMediaModule))
  jobRuntime.registerResolver(createMediaDecodedResolver(unifiedMediaModule))
  jobRuntime.registerResolver(createMediaSourceProcessedResolver(unifiedMediaModule))
  jobRuntime.registerResolver(createMediaReadyResolver(unifiedMediaModule))
  jobRuntime.registerResolver(
    createAIInputPreparedResolver({
      getMediaItem: unifiedMediaModule.getMediaItem,
      ensureMediaReady,
      getBizyAirApiKey: async () => unifiedUserModule.getBizyAirApiKey(),
    }),
  )
  jobRuntime.registerResolver(
    createAITaskSubmittedResolver({
      getMediaItem: unifiedMediaModule.getMediaItem,
      ensureMediaReady,
      getBizyAirApiKey: async () => unifiedUserModule.getBizyAirApiKey(),
    }),
  )
  jobRuntime.registerResolver(
    createRemoteTaskCompletedResolver({
      getMediaItem: unifiedMediaModule.getMediaItem,
      ensureMediaReady,
      getBizyAirApiKey: async () => unifiedUserModule.getBizyAirApiKey(),
    }),
  )
  jobRuntime.registerResolver(
    createAIGeneratedMediaResolver({
      getMediaItem: unifiedMediaModule.getMediaItem,
      ensureMediaReady,
      getBizyAirApiKey: async () => unifiedUserModule.getBizyAirApiKey(),
    }),
  )
  jobRuntime.registerResolver(createASRRemoteTaskCompletedResolver())
  jobRuntime.registerResolver(
    createASRSubtitlesResolver({
      getTimelineItem: unifiedTimelineModule.getTimelineItem,
      getTimelineItems: () => unifiedTimelineModule.timelineItems.value,
      addTimelineItem: unifiedTimelineModule.addTimelineItem,
      removeTimelineItem: unifiedTimelineModule.removeTimelineItem,
      getTrack: unifiedTrackModule.getTrack,
    }),
  )
  jobRuntime.registerResolver(
    createTimelineItemReadyResolver({
      getTimelineItem: unifiedTimelineModule.getTimelineItem,
      getMediaItem: unifiedMediaModule.getMediaItem,
    }),
  )
  jobRuntime.registerResolver(
    createEffectTemplateReadyResolver({
      getAsset: (assetId) => {
        const asset = unifiedMediaModule.getAsset(assetId)
        return asset?.assetKind === 'effect-template' ? asset : undefined
      },
      getProjectId: () => {
        const projectId = unifiedConfigModule.projectId.value
        if (!projectId) {
          throw new Error('当前项目未初始化')
        }
        return projectId
      },
    }),
  )
  const jobTaskCenter = useJobTaskCenter(jobRuntime)

  function ensureMediaReady(mediaId: string) {
    return jobRuntime.ensure(createMediaReadyRequest(mediaId))
  }
  function ensureAIGeneratedMedia(mediaId: string) {
    return jobRuntime.ensure(createAIGeneratedMediaRequest(mediaId))
  }
  function ensureTimelineItemReady(timelineItemId: string) {
    return jobRuntime.ensure(createTimelineItemReadyRequest(timelineItemId))
  }
  function ensureASRSubtitles(placeholderTimelineItemId: string) {
    return jobRuntime.ensure(createASRSubtitlesRequest(placeholderTimelineItemId))
  }
  function ensureEffectTemplateReady(assetId: string) {
    return jobRuntime.ensure(createEffectTemplateReadyRequest(assetId))
  }
  async function retryEffectTemplateReady(assetId: string) {
    const request = createEffectTemplateReadyRequest(assetId)
    const retried = await jobRuntime.retry(getResourceId(request.type, assetId))
    if (retried) {
      return
    }

    await jobRuntime.ensure(request)
  }
  function cancelEffectTemplateReady(assetId: string) {
    const request = createEffectTemplateReadyRequest(assetId)
    return jobRuntime.cancel(getResourceId(request.type, assetId))
  }
  function ensureTimelineItemResolved(timelineItemId: string) {
    const timelineItem = unifiedTimelineModule.getTimelineItem(timelineItemId)
    if (!timelineItem) {
      return Promise.resolve(null)
    }

    if (timelineItem.isPlaceholder && timelineItem.task?.kind === 'asr-subtitles') {
      return ensureASRSubtitles(timelineItem.id)
    }

    if (timelineItem.timelineStatus === 'loading') {
      return ensureTimelineItemReady(timelineItem.id)
    }

    return Promise.resolve(null)
  }
  unifiedProjectModule.setMediaReadyEnsurer(ensureMediaReady)
  unifiedProjectModule.setAIGeneratedMediaEnsurer(ensureAIGeneratedMedia)
  unifiedProjectModule.setEffectTemplateReadyEnsurer(ensureEffectTemplateReady)
  unifiedProjectModule.setTimelineItemResolvedEnsurer(ensureTimelineItemResolved)
  unifiedDirectoryModule.setMediaReadyEnsurer(ensureMediaReady)
  unifiedDirectoryModule.setEffectTemplateReadyEnsurer(ensureEffectTemplateReady)

  // 创建历史记录操作模块
  const historyOperations = useHistoryOperations(
    unifiedHistoryModule,
    unifiedTimelineModule,
    unifiedMediaModule,
    unifiedConfigModule,
    unifiedTrackModule,
    unifiedSelectionModule,
    ensureTimelineItemResolved,
  )

  // 创建统一拖拽管理器（已自动注册所有处理器）
  const dragManager = useUnifiedDrag(
    unifiedDirectoryModule,
    unifiedMediaModule,
    unifiedTimelineModule,
    unifiedSelectionModule,
    unifiedTrackModule,
  )

  // ==================== 导出接口 ====================

  return {
    // ==================== 历史记录包装方法导出 ====================

    // 时间轴项目历史记录方法
    addTimelineItemWithHistory: historyOperations.addTimelineItemWithHistory,
    removeTimelineItemWithHistory: historyOperations.removeTimelineItemWithHistory,
    moveTimelineItemWithHistory: historyOperations.moveTimelineItemWithHistory,
    updateTimelineItemTransformWithHistory:
      historyOperations.updateTimelineItemTransformWithHistory,
    updateTransitionOutWithHistory: historyOperations.updateTransitionOutWithHistory,
    updateFilterEffectWithHistory: historyOperations.updateFilterEffectWithHistory,
    commitFilterEffectWithHistory: historyOperations.commitFilterEffectWithHistory,
    removeFilterEffectWithHistory: historyOperations.removeFilterEffectWithHistory,
    splitTimelineItemAtTimeWithHistory: historyOperations.splitTimelineItemAtTimeWithHistory,
    duplicateTimelineItemWithHistory: historyOperations.duplicateTimelineItemWithHistory,
    resizeTimelineItemWithHistory: historyOperations.resizeTimelineItemWithHistory,
    // 轨道历史记录方法
    addTrackWithHistory: historyOperations.addTrackWithHistory,
    removeTrackWithHistory: historyOperations.removeTrackWithHistory,
    renameTrackWithHistory: historyOperations.renameTrackWithHistory,
    moveTrackWithHistory: historyOperations.moveTrackWithHistory,
    autoArrangeTrackWithHistory: historyOperations.autoArrangeTrackWithHistory,
    toggleTrackVisibilityWithHistory: historyOperations.toggleTrackVisibilityWithHistory,
    toggleTrackMuteWithHistory: historyOperations.toggleTrackMuteWithHistory,
    updateTextContentWithHistory: historyOperations.updateTextContentWithHistory,
    updateTextStyleWithHistory: historyOperations.updateTextStyleWithHistory,
    selectTimelineSelectionsWithHistory: historyOperations.selectTimelineSelectionsWithHistory,
    // 关键帧历史记录方法
    createKeyframeWithHistory: historyOperations.createKeyframeWithHistory,
    deleteKeyframeWithHistory: historyOperations.deleteKeyframeWithHistory,
    updatePropertyWithHistory: historyOperations.updatePropertyWithHistory,
    updateMaskWithHistory: historyOperations.updateMaskWithHistory,
    updateAnimationGroupValueWithHistory: historyOperations.updateAnimationGroupValueWithHistory,
    updateAnimationGroupsBatchWithHistory: historyOperations.updateAnimationGroupsBatchWithHistory,
    clearAllKeyframesWithHistory: historyOperations.clearAllKeyframesWithHistory,
    toggleKeyframeWithHistory: historyOperations.toggleKeyframeWithHistory,
    toggleProportionalScaleWithHistory: historyOperations.toggleProportionalScaleWithHistory,

    // ==================== 统一媒体模块状态和方法 ====================

    // 媒体项目状态
    mediaItems: unifiedMediaModule.mediaItems,
    jobRuntime,
    jobTaskViews: jobTaskCenter.taskViews,
    cancelJobTask: jobTaskCenter.cancelTask,
    retryJobTask: jobTaskCenter.retryTask,
    ensureMediaReady,
    ensureAIGeneratedMedia,
    ensureTimelineItemReady,
    ensureASRSubtitles,
    ensureTimelineItemResolved,

    // 媒体项目管理方法
    addMediaItem: unifiedMediaModule.addMediaItem,
    removeMediaItem: unifiedMediaModule.removeMediaItem,
    getMediaItem: unifiedMediaModule.getMediaItem,
    addAsset: unifiedMediaModule.addAsset,
    removeAsset: unifiedMediaModule.removeAsset,
    getAsset: unifiedMediaModule.getAsset,
    getAllAssets: unifiedMediaModule.getAllAssets,
    updateAssetName: unifiedMediaModule.updateAssetName,
    createTransitionTemplatePlaceholder:
      unifiedMediaModule.createTransitionTemplatePlaceholder,
    createFilterTemplatePlaceholder:
      unifiedMediaModule.createFilterTemplatePlaceholder,
    startTemplateProcessing: ensureEffectTemplateReady,
    retryTemplateProcessing: retryEffectTemplateReady,
    cancelTemplateProcessing: cancelEffectTemplateReady,
    ensureEffectTemplateReady,
    getMediaItemBySourceId: unifiedMediaModule.getMediaItemBySourceId,
    updateMediaItemName: unifiedMediaModule.updateMediaItemName,
    updateMediaItem: unifiedMediaModule.updateMediaItem,
    updateMediaItemMetadata: unifiedMediaModule.updateMediaItemMetadata,
    getAllMediaItems: unifiedMediaModule.getAllMediaItems,

    // 分辨率管理方法
    getVideoOriginalResolution: unifiedMediaModule.getVideoOriginalResolution,
    getImageOriginalResolution: unifiedMediaModule.getImageOriginalResolution,

    // 异步等待方法
    waitForMediaItemReady: unifiedMediaModule.waitForMediaItemReady,

    // 数据源处理方法
    startMediaProcessing: unifiedMediaModule.startMediaProcessing,
    cancelMediaProcessing: unifiedMediaModule.cancelMediaProcessing,

    // 便捷查询方法
    getReadyMediaItems: unifiedMediaModule.getReadyMediaItems,
    getReadyEffectTemplateAssets: unifiedMediaModule.getReadyEffectTemplateAssets,
    getProcessingMediaItems: unifiedMediaModule.getProcessingMediaItems,
    getErrorMediaItems: unifiedMediaModule.getErrorMediaItems,
    getMediaItemsBySourceType: unifiedMediaModule.getMediaItemsBySourceType,
    getMediaItemsStats: unifiedMediaModule.getMediaItemsStats,

    // 工厂函数和查询函数
    createUnifiedMediaItemData: unifiedMediaModule.createUnifiedMediaItemData,
    MediaItemQueries: unifiedMediaModule.MediaItemQueries,
    UnifiedMediaItemActions: unifiedMediaModule.UnifiedMediaItemActions,

    // ==================== 统一轨道模块状态和方法 ====================

    // 轨道状态
    tracks: unifiedTrackModule.tracks,

    // 轨道管理方法
    addTrack: unifiedTrackModule.addTrack,
    removeTrack: unifiedTrackModule.removeTrack,
    renameTrack: unifiedTrackModule.renameTrack,
    moveTrack: unifiedTrackModule.moveTrack,
    getTrack: unifiedTrackModule.getTrack,
    setTrackHeight: unifiedTrackModule.setTrackHeight,
    toggleTrackVisibility: unifiedTrackModule.toggleTrackVisibility,
    toggleTrackMute: unifiedTrackModule.toggleTrackMute,
    getTracksSummary: unifiedTrackModule.getTracksSummary,
    resetTracksToDefaults: unifiedTrackModule.resetTracksToDefaults,

    // 轨道恢复方法
    restoreTracks: unifiedTrackModule.restoreTracks,

    // ==================== 统一时间轴模块状态和方法 ====================

    // 时间轴项目状态
    timelineItems: unifiedTimelineModule.timelineItems,

    // 时间轴项目管理方法
    addTimelineItem: unifiedTimelineModule.addTimelineItem,
    removeTimelineItem: unifiedTimelineModule.removeTimelineItem,
    getTimelineItem: unifiedTimelineModule.getTimelineItem,
    getReadyTimelineItem: unifiedTimelineModule.getReadyTimelineItem,
    updateTimelineItemPosition: unifiedTimelineModule.updateTimelineItemPosition,
    updateTimelineItemTransform: unifiedTimelineModule.updateTimelineItemTransform,
    updateTimelineItemPlaybackRate: unifiedTimelineModule.updateTimelineItemPlaybackRate,
    setTimelineItemTimeRangeForCmd: unifiedTimelineModule.setTimelineItemTimeRangeForCmd,
    setTimelineItemTransitionOutForCmd:
      unifiedTimelineModule.setTimelineItemTransitionOutForCmd,
    setTimelineItemFilterEffectForCmd:
      unifiedTimelineModule.setTimelineItemFilterEffectForCmd,
    refreshTransitionItems: unifiedTimelineModule.refreshTransitionItems,
    getTransitionOverlay: unifiedTimelineModule.getTransitionOverlay,
    getTransitionOverlaysByTrack: unifiedTimelineModule.getTransitionOverlaysByTrack,

    // ==================== 统一项目模块状态和方法 ====================

    // 项目状态
    projectStatus: unifiedProjectModule.projectStatus,
    isProjectSaving: unifiedProjectModule.isSaving,
    isProjectLoading: unifiedProjectModule.isLoading,

    // 项目加载进度状态
    projectLoadingProgress: unifiedProjectModule.loadingProgress,
    projectLoadingStage: unifiedProjectModule.loadingStage,
    projectLoadingDetails: unifiedProjectModule.loadingDetails,
    showProjectLoadingProgress: unifiedProjectModule.showLoadingProgress,
    isProjectSettingsReady: unifiedProjectModule.isProjectSettingsReady,
    isProjectTimelineReady: unifiedProjectModule.isProjectTimelineReady,

    // 项目管理方法
    saveCurrentProject: unifiedProjectModule.saveCurrentProject,
    preloadProjectSettings: unifiedProjectModule.preloadProjectSettings,
    loadProjectContent: unifiedProjectModule.loadProjectContent,
    clearCurrentProject: unifiedProjectModule.clearCurrentProject,
    getProjectSummary: unifiedProjectModule.getProjectSummary,

    // 项目加载进度控制
    updateLoadingProgress: unifiedProjectModule.updateLoadingProgress,
    resetLoadingState: unifiedProjectModule.resetLoadingState,

    // ==================== 播放控制模块状态和方法 ====================

    // 播放控制状态
    currentFrame: unifiedPlaybackModule.currentFrame,
    isPlaying: unifiedPlaybackModule.isPlaying,
    playbackRate: unifiedPlaybackModule.playbackRate,

    // 计算属性
    formattedCurrentTime: unifiedPlaybackModule.formattedCurrentTime,
    playbackRateText: unifiedPlaybackModule.playbackRateText,

    // 帧数控制方法
    setCurrentFrame: unifiedPlaybackModule.setCurrentFrame,
    seekToFrame: unifiedPlaybackModule.seekToFrame,

    // 播放控制方法
    setPlaying: unifiedPlaybackModule.setPlaying,
    play: unifiedPlaybackModule.play,
    pause: unifiedPlaybackModule.pause,
    togglePlayPause: unifiedPlaybackModule.togglePlayPause,
    stop: unifiedPlaybackModule.stop,
    setPlaybackRate: unifiedPlaybackModule.setPlaybackRate,
    resetPlaybackRate: unifiedPlaybackModule.resetPlaybackRate,
    resetPlaybackToDefaults: unifiedPlaybackModule.resetToDefaults,

    // ==================== 配置模块状态和方法 ====================

    // 配置
    projectId: unifiedConfigModule.projectId,
    projectName: unifiedConfigModule.projectName,
    projectDescription: unifiedConfigModule.projectDescription,
    projectCreatedAt: unifiedConfigModule.projectCreatedAt,
    projectUpdatedAt: unifiedConfigModule.projectUpdatedAt,
    projectVersion: unifiedConfigModule.projectVersion,
    projectThumbnail: unifiedConfigModule.projectThumbnail,

    // 配置状态
    videoResolution: unifiedConfigModule.videoResolution,
    timelineDurationFrames: unifiedConfigModule.timelineDurationFrames,

    // 配置管理方法
    setVideoResolution: unifiedConfigModule.setVideoResolution,
    resetConfigToDefaults: unifiedConfigModule.resetToDefaults,
    restoreFromProjectSettings: unifiedConfigModule.restoreFromProjectSettings,

    // ==================== MediaBunny模块状态和方法 ====================

    // MediaBunny状态
    isMediaBunnyReady: unifiedMediaBunnyModule.isMediaBunnyReady,
    mediaBunnyError: unifiedMediaBunnyModule.mediaBunnyError,

    // MediaBunny画布管理
    setMediaBunnyCanvas: unifiedMediaBunnyModule.setCanvas,
    destroyMediaBunny: unifiedMediaBunnyModule.destroy,

    // MediaBunny播放控制
    mediaBunnyStartPlayback: unifiedMediaBunnyModule.startPlayback,
    mediaBunnyStopPlayback: unifiedMediaBunnyModule.stopPlayback,
    mediaBunnySeekToFrame: unifiedMediaBunnyModule.seekToFrame,
    updateMediaBunnyTimelineDuration: unifiedMediaBunnyModule.updateTimelineDuration,

    // MediaBunny截帧功能
    captureCanvasFrame: unifiedMediaBunnyModule.captureCanvasFrame,

    // MediaBunny工具方法
    isMediaBunnyAvailable: unifiedMediaBunnyModule.isMediaBunnyAvailable,
    resetMediaBunnyToDefaults: unifiedMediaBunnyModule.resetToDefaults,

    // ==================== 统一视口模块状态和方法 ====================

    // 视口状态
    TimelineContainerWidth: unifiedViewportModule.TimelineContainerWidth,
    zoomLevel: unifiedViewportModule.zoomLevel,
    scrollOffset: unifiedViewportModule.scrollOffset,

    // 视口计算属性
    totalDurationFrames: unifiedViewportModule.totalDurationFrames,
    minZoomLevel: unifiedViewportModule.minZoomLevel,
    visibleDurationFrames: unifiedViewportModule.visibleDurationFrames,
    maxVisibleDurationFrames: unifiedViewportModule.maxVisibleDurationFrames,
    contentEndTimeFrames: unifiedViewportModule.contentEndTimeFrames,
    TimelineContentWidth: unifiedViewportModule.TimelineContentWidth,

    // 视口管理方法
    getMaxZoomLevelForTimeline: unifiedViewportModule.getMaxZoomLevelForTimeline,
    getMaxScrollOffsetForTimeline: unifiedViewportModule.getMaxScrollOffsetForTimeline,
    setZoomLevel: unifiedViewportModule.setZoomLevel,
    setScrollOffset: unifiedViewportModule.setScrollOffset,
    setContainerWidth: unifiedViewportModule.setContainerWidth,
    zoomIn: unifiedViewportModule.zoomIn,
    zoomOut: unifiedViewportModule.zoomOut,
    scrollLeft: unifiedViewportModule.scrollLeft,
    scrollRight: unifiedViewportModule.scrollRight,
    scrollToFrame: unifiedViewportModule.scrollToFrame,
    resetViewport: unifiedViewportModule.resetViewport,
    getViewportSummary: unifiedViewportModule.getViewportSummary,

    // ==================== 通知模块状态和方法 ====================

    // 便捷通知方法
    messageSuccess: unifiedUseNaiveUIModule.messageSuccess,
    messageError: unifiedUseNaiveUIModule.messageError,
    messageWarning: unifiedUseNaiveUIModule.messageWarning,
    messageInfo: unifiedUseNaiveUIModule.messageInfo,

    // 便捷对话框方法
    dialogSuccess: unifiedUseNaiveUIModule.dialogSuccess,
    dialogError: unifiedUseNaiveUIModule.dialogError,
    dialogWarning: unifiedUseNaiveUIModule.dialogWarning,
    dialogInfo: unifiedUseNaiveUIModule.dialogInfo,

    // 便捷模态框方法
    createModal: unifiedUseNaiveUIModule.createModal,
    destroyAllModals: unifiedUseNaiveUIModule.destroyAllModals,

    // 加载弹窗方法
    createLoading: unifiedUseNaiveUIModule.createLoading,

    // 系统通知方法
    notifySystem: unifiedUseNaiveUIModule.notifySystem,

    initApi: unifiedUseNaiveUIModule.initApi,

    // ==================== 历史模块状态和方法 ====================

    // 历史状态
    canUndo: unifiedHistoryModule.canUndo,
    canRedo: unifiedHistoryModule.canRedo,

    // 历史操作方法
    undo: unifiedHistoryModule.undo,
    redo: unifiedHistoryModule.redo,
    clearHistory: unifiedHistoryModule.clear,
    getHistorySummary: unifiedHistoryModule.getHistorySummary,
    getCommand: unifiedHistoryModule.getCommand,
    startBatch: unifiedHistoryModule.startBatch,
    executeBatchCommand: unifiedHistoryModule.executeBatchCommand,

    // ==================== 统一选择模块状态和方法 ====================
    selectedLibraryAssetIds: unifiedSelectionModule.selectedLibraryAssetIds,
    selectedLibraryAssetId: unifiedSelectionModule.selectedLibraryAssetId,
    hasLibraryAssetSelection: unifiedSelectionModule.hasLibraryAssetSelection,
    isLibraryAssetMultiSelectMode: unifiedSelectionModule.isLibraryAssetMultiSelectMode,
    selectLibraryAssets: unifiedSelectionModule.selectLibraryAssets,
    selectLibraryAsset: unifiedSelectionModule.selectLibraryAsset,
    isLibraryAssetSelected: unifiedSelectionModule.isLibraryAssetSelected,
    clearLibraryAssetSelection: unifiedSelectionModule.clearLibraryAssetSelection,

    // 选择状态
    selectedTimelineSelectionId: unifiedSelectionModule.selectedTimelineSelectionId,
    selectedTimelineSelectionIds: unifiedSelectionModule.selectedTimelineSelectionIds,
    isTimelineSelectionMultiSelectMode:
      unifiedSelectionModule.isTimelineSelectionMultiSelectMode,
    hasSelection: unifiedSelectionModule.hasSelection,
    selectedClipTimelineItemId: unifiedSelectionModule.selectedClipTimelineItemId,
    selectedClipTimelineItemIds: unifiedSelectionModule.selectedClipTimelineItemIds,
    selectedTransitionSourceItemId: unifiedSelectionModule.selectedTransitionSourceItemId,
    selectedTransitionSourceItemIds: unifiedSelectionModule.selectedTransitionSourceItemIds,

    // 统一选择API
    selectTimelineSelections: unifiedSelectionModule.selectTimelineSelections,
    selectTimelineSelection: unifiedSelectionModule.selectTimelineSelection,
    clearTimelineSelection: unifiedSelectionModule.clearTimelineSelection,
    clearAllSelections: unifiedSelectionModule.clearAllSelections,
    isTimelineSelectionSelected: unifiedSelectionModule.isTimelineSelectionSelected,
    clearSelectionsForTimelineItem: unifiedSelectionModule.clearSelectionsForTimelineItem,
    getSelectedClipTimelineItem: unifiedSelectionModule.getSelectedClipTimelineItem,
    getSelectedTransitionOverlay: unifiedSelectionModule.getSelectedTransitionOverlay,
    getSelectionSummary: unifiedSelectionModule.getSelectionSummary,
    resetSelectionToDefaults: unifiedSelectionModule.resetToDefaults,

    // ==================== 坐标转换方法 ====================
    frameToPixel: (frames: number, timelineWidth: number) =>
      frameToPixel(
        frames,
        timelineWidth,
        unifiedViewportModule.totalDurationFrames.value,
        unifiedViewportModule.zoomLevel.value,
        unifiedViewportModule.scrollOffset.value,
      ),
    pixelToFrame: (pixel: number, timelineWidth: number) =>
      pixelToFrame(
        pixel,
        timelineWidth,
        unifiedViewportModule.totalDurationFrames.value,
        unifiedViewportModule.zoomLevel.value,
        unifiedViewportModule.scrollOffset.value,
      ),

    // ==================== 时间轴搜索工具函数 ====================
    getTimelineItemsByTrack: (trackId: string) =>
      getTimelineItemsByTrack(trackId, unifiedTimelineModule.timelineItems.value),
    isPlayheadInTimelineItem: (item: UnifiedTimelineItemData, currentFrame: number) =>
      isPlayheadInTimelineItem(item, currentFrame),
    findOverlappingTimelineItems: (startTime: number, endTime: number, excludeItemId?: string) =>
      findOverlappingTimelineItems(
        startTime,
        endTime,
        unifiedTimelineModule.timelineItems.value,
        excludeItemId,
      ),

    // ==================== 统一自动保存模块状态和方法 ====================

    // 自动保存状态
    autoSaveState: unifiedAutoSaveModule.autoSaveState,
    autoSaveConfig: unifiedAutoSaveModule.config,

    // 自动保存方法
    enableAutoSave: unifiedAutoSaveModule.enableAutoSave,
    disableAutoSave: unifiedAutoSaveModule.disableAutoSave,
    manualSave: unifiedAutoSaveModule.manualSave,
    triggerAutoSave: unifiedAutoSaveModule.triggerAutoSave,
    resetAutoSaveState: unifiedAutoSaveModule.resetAutoSaveState,

    // ==================== 视频缩略图方法 ====================
    requestThumbnails: unifiedVideoThumbnailModule.requestThumbnails,
    cancelThumbnailTasks: unifiedVideoThumbnailModule.cancelTasks,
    cleanupThumbnailScheduler: unifiedVideoThumbnailModule.cleanup,

    // ==================== 统一用户模块状态和方法 ====================

    // 用户认证状态
    currentUser: unifiedUserModule.currentUser,
    isLoggedIn: unifiedUserModule.isLoggedIn,
    username: unifiedUserModule.username,
    isLoggingIn: unifiedUserModule.isLoggingIn,
    isRegistering: unifiedUserModule.isRegistering,
    isUsingActivationCode: unifiedUserModule.isUsingActivationCode,
    bizyairApiKey: unifiedUserModule.bizyairApiKey,

    // 用户认证方法
    login: unifiedUserModule.login,
    register: unifiedUserModule.register,
    logout: unifiedUserModule.logout,

    // 用户信息获取
    getCurrentUser: unifiedUserModule.getCurrentUser,
    getAccessToken: unifiedUserModule.getAccessToken,
    checkLoginStatus: unifiedUserModule.checkLoginStatus,

    // 激活码功能
    useActivationCode: unifiedUserModule.useActivationCode,

    // BizyAir API Key 管理
    saveBizyAirApiKey: unifiedUserModule.saveBizyAirApiKey,
    getBizyAirApiKey: unifiedUserModule.getBizyAirApiKey,
    clearBizyAirApiKey: unifiedUserModule.clearBizyAirApiKey,
    hasBizyAirApiKey: unifiedUserModule.hasBizyAirApiKey,

    // ==================== 工具函数导出 ====================
    getThumbnailUrl: unifiedVideoThumbnailModule.getThumbnailUrl,

    // ==================== 统一吸附模块状态和方法 ====================

    // 吸附功能状态
    snapConfig: unifiedSnapModule.snapConfig,
    isSnapCalculating: unifiedSnapModule.isCalculating,
    isSnapCacheUpdating: unifiedSnapModule.isCacheUpdating,

    // 吸附功能方法
    updateSnapConfig: unifiedSnapModule.updateSnapConfig,
    calculateSnapPosition: unifiedSnapModule.calculateSnapPosition,
    collectSnapTargets: unifiedSnapModule.collectSnapTargets,
    clearSnapCache: unifiedSnapModule.clearCache,
    isSnapCacheValid: unifiedSnapModule.isCacheValid,
    getSnapSummary: unifiedSnapModule.getSnapSummary,

    // 拖拽集成方法
    startSnapDrag: unifiedSnapModule.startDrag,
    endSnapDrag: unifiedSnapModule.endDrag,

    // ==================== 统一目录模块状态和方法 ====================

    // 目录状态
    directories: unifiedDirectoryModule.directories,
    openTabs: unifiedDirectoryModule.openTabs,
    activeTabId: unifiedDirectoryModule.activeTabId,

    // 目录计算属性
    activeTab: unifiedDirectoryModule.activeTab,
    currentDir: unifiedDirectoryModule.currentDir,

    // 目录管理方法
    createDirectory: unifiedDirectoryModule.createDirectory,
    createCharacterDirectory: unifiedDirectoryModule.createCharacterDirectory, // 🆕 新增创建角色文件夹方法
    renameDirectory: unifiedDirectoryModule.renameDirectory,
    deleteDirectory: unifiedDirectoryModule.deleteDirectory, // 🆕 新增删除文件夹方法
    deleteAssetItem: unifiedDirectoryModule.deleteAssetItem,
    deleteMediaItem: unifiedDirectoryModule.deleteMediaItem, // 🆕 新增删除媒体项方法
    findAllDirectoriesByAssetId: unifiedDirectoryModule.findAllDirectoriesByAssetId,
    getDirectory: unifiedDirectoryModule.getDirectory,
    getCharacterDirectory: unifiedDirectoryModule.getCharacterDirectory, // 🆕 新增获取角色文件夹方法
    isCharacterDirectory: unifiedDirectoryModule.isCharacterDirectory, // 🆕 新增类型守卫方法
    addAssetToDirectory: unifiedDirectoryModule.addAssetToDirectory,
    removeAssetFromDirectory: unifiedDirectoryModule.removeAssetFromDirectory,
    getDirectoryContent: unifiedDirectoryModule.getDirectoryContent,
    getBreadcrumb: unifiedDirectoryModule.getBreadcrumb,
    openTab: unifiedDirectoryModule.openTab,
    closeTab: unifiedDirectoryModule.closeTab,
    navigateToDir: unifiedDirectoryModule.navigateToDir,
    switchTab: unifiedDirectoryModule.switchTab,

    // 目录初始化和管理方法
    initializeRootDirectory: unifiedDirectoryModule.initializeRootDirectory,
    getAllDirectories: unifiedDirectoryModule.getAllDirectories,
    resetDirectories: unifiedDirectoryModule.resetDirectories,
    getDirectorySummary: unifiedDirectoryModule.getDirectorySummary,

    // 剪贴板状态
    clipboardState: unifiedDirectoryModule.clipboardState,

    // 剪贴板操作
    cut: unifiedDirectoryModule.cut,
    copy: unifiedDirectoryModule.copy,
    paste: unifiedDirectoryModule.paste,
    canPaste: unifiedDirectoryModule.canPaste,
    clearClipboard: unifiedDirectoryModule.clearClipboard,

    // 拖拽专用方法
    canDragToFolder: unifiedDirectoryModule.canDragToFolder,
    dragMoveMediaItems: unifiedDirectoryModule.dragMoveMediaItems,
    dragMoveFolder: unifiedDirectoryModule.dragMoveFolder,

    // 视图和排序状态
    viewMode: unifiedDirectoryModule.viewMode,
    sortBy: unifiedDirectoryModule.sortBy,
    sortOrder: unifiedDirectoryModule.sortOrder,

    // 视图和排序方法
    setViewMode: unifiedDirectoryModule.setViewMode,
    setSortBy: unifiedDirectoryModule.setSortBy,
    setSortOrder: unifiedDirectoryModule.setSortOrder,

    // ==================== 统一拖拽管理器方法 ====================

    // 拖拽核心方法
    startDrag: dragManager.startDrag,
    handleDragOver: dragManager.handleDragOver,
    handleDrop: dragManager.handleDrop,
    endDrag: dragManager.endDrag,
    getCurrentDragData: dragManager.getCurrentDragData,

    // 拖拽查询方法
    getSourceHandler: dragManager.getSourceHandler,
    getTargetHandler: dragManager.getTargetHandler,

    // ==================== UI 模块状态和方法 ====================

    // AI 面板状态
    isChatPanelVisible: unifiedUIModule.isChatPanelVisible,
    aiPanelActiveTab: unifiedUIModule.aiPanelActiveTab,
    activePropertyTab: unifiedUIModule.activePropertyTab,

    // 角色编辑器状态
    characterEditorState: unifiedUIModule.characterEditorState,

    // 角色编辑器计算属性
    curCharacterDir: unifiedUIModule.curCharacterDir,
    canShowCharacterEditor: unifiedUIModule.canShowCharacterEditor,

    // AI 面板状态管理方法
    setChatPanelVisible: unifiedUIModule.setChatPanelVisible,
    setActivePropertyTab: unifiedUIModule.setActivePropertyTab,

    // 角色编辑器方法
    openCharacterEditor: unifiedUIModule.openCharacterEditor,
    closeCharacterEditor: unifiedUIModule.closeCharacterEditor,
  }
})
