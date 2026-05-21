import { ref, watch, type Raw } from 'vue'
import {
  type UnifiedMediaItemData,
  type MediaStatus,
  type MediaType,
  type UnifiedMediaItemMetadata,
  createUnifiedMediaItemData,
  MediaItemQueries,
  UnifiedMediaItemActions,
} from '@/core'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { ModuleRegistry } from '@/core/modules/ModuleRegistry'
import { MODULE_NAMES } from '@/core/modules/ModuleRegistry'
import type { UnifiedProjectModule } from '@/core/modules/UnifiedProjectModule'
import type { UnifiedTimelineModule } from '@/core/modules/UnifiedTimelineModule'
import type { UnifiedAutoSaveModule } from '@/core/modules/UnifiedAutoSaveModule'
import { getDataSourceRegistry } from '@/core/datasource/registry'
import { SourceOrigin } from '@/core/datasource/core/BaseDataSource'
import {
  getResourceId,
  JobLogger,
  JobRuntime,
  MediaDecodedResolver,
  MediaFileAvailableResolver,
  MediaReadyResolver,
  type TaskViewItem,
} from '@/core/jobs'
import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'
import type {
  EffectTemplateAssetData,
  UnifiedLibraryAssetData,
} from '@/core/asset/types'
import {
  isEffectTemplateAsset,
  isMediaAsset,
} from '@/core/asset/types'
import { EffectTemplateManager } from '@/core/effect-template/EffectTemplateManager'
import { clearChannelKeyframes } from '@/core/utils/unifiedKeyframeUtils'

// ==================== 统一媒体项目调试工具 ====================

/**
 * 统一媒体项目调试信息打印函数
 * @param operation 操作名称
 * @param details 操作详情
 * @param mediaItems 统一媒体项目数组
 */
function printUnifiedDebugInfo(
  operation: string,
  details: unknown,
  mediaItems: UnifiedMediaItemData[],
) {
  const timestamp = new Date().toLocaleTimeString()
  console.group(`🎬 [${timestamp}] ${operation}`)

  if (details) {
    console.log('📋 操作详情:', details)
  }

  console.log('📚 统一媒体项目状态:')
  console.table(
    mediaItems.map((item) => ({
      id: item.id,
      name: item.name,
      duration: item.duration ? `${item.duration}帧` : '未知',
      mediaType: item.mediaType,
      mediaStatus: item.mediaStatus,
      sourceType: item.source.type,
      sourceProgress: `${item.source.progress}%`,
      createdAt: new Date(item.createdAt).toLocaleTimeString(),
    })),
  )

  console.log('📊 统计信息:')
  const statusCounts = mediaItems.reduce(
    (acc, item) => {
      acc[item.mediaStatus] = (acc[item.mediaStatus] || 0) + 1
      return acc
    },
    {} as Record<string, number>,
  )

  console.log(`- 总项目数: ${mediaItems.length}`)
  console.log(`- 状态分布:`, statusCounts)

  console.groupEnd()
}

// ==================== 统一媒体项目管理模块 ====================

/**
 * 统一媒体管理模块
 * 负责管理素材库中的统一媒体项目
 */
export function createUnifiedMediaModule(registry: ModuleRegistry) {
  // ==================== 状态定义 ====================

  // 统一媒体项目列表
  const mediaItems = ref<UnifiedMediaItemData[]>([])
  const effectTemplateAssets = ref<EffectTemplateAssetData[]>([])
  const effectTemplateManager = new EffectTemplateManager(
    registry,
    (assetId) => effectTemplateAssets.value.find((item) => item.id === assetId),
  )
  const jobRuntime = new JobRuntime()
  let mediaReadyResolverRegistered = false

  // ==================== 媒体项目管理方法 ====================

  /**
   * 添加媒体项目到素材库
   * @param mediaItem 媒体项目
   */
  function addMediaItem(mediaItem: UnifiedMediaItemData) {
    mediaItems.value.push(mediaItem)
    printUnifiedDebugInfo(
      '添加统一媒体项目到素材库',
      {
        mediaItemId: mediaItem.id,
        name: mediaItem.name,
        duration: mediaItem.duration,
        mediaType: mediaItem.mediaType,
        mediaStatus: mediaItem.mediaStatus,
        sourceType: mediaItem.source.type,
      },
      getAllMediaItems(),
    )
  }

  function addAsset(asset: UnifiedLibraryAssetData) {
    if (isMediaAsset(asset)) {
      addMediaItem(asset)
      return
    }

    effectTemplateAssets.value.push(asset)
    const autoSaveModule = registry.get<UnifiedAutoSaveModule>(MODULE_NAMES.AUTOSAVE)
    autoSaveModule.setupMediaItemWatcher(asset)

    // Project restore should only hydrate in-memory state and watchers.
    // Initial meta persistence is reserved for user-created template assets.
    if (asset.source.sourceOrigin === SourceOrigin.USER_CREATE) {
      void globalMetaFileManager.saveMetaFile(asset)
    }
  }

  /**
   * 从素材库删除媒体项目
   * @param mediaItemId 媒体项目ID
   */
  async function removeMediaItem(mediaItemId: string) {
    const index = mediaItems.value.findIndex(
      (item: UnifiedMediaItemData) => item.id === mediaItemId,
    )
    if (index > -1) {
      const mediaItem = mediaItems.value[index]

      // 1. 🌟 清理 watcher
      const autoSaveModule = registry.get<UnifiedAutoSaveModule>(MODULE_NAMES.AUTOSAVE)
      autoSaveModule.cleanupMediaItemWatcher(mediaItemId)

      // 2. 清理相关的时间轴项目（先清理使用该素材的时间轴项目）
      await cleanupRelatedTimelineItems(mediaItemId)

      // 3. 清理 bunnyMedia
      if (mediaItem.runtime.bunny?.bunnyMedia) {
        await mediaItem.runtime.bunny.bunnyMedia.dispose()
        mediaItem.runtime.bunny.bunnyMedia = undefined
        console.log(`🧹 [UnifiedMediaModule] bunnyMedia已清理: ${mediaItem.name}`)
      }

      // 4. 清理缩略图URL
      if (mediaItem.runtime.bunny?.thumbnailUrl) {
        URL.revokeObjectURL(mediaItem.runtime.bunny.thumbnailUrl)
        console.log(`🧹 [UnifiedMediaModule] bunny缩略图URL已清理: ${mediaItem.name}`)
      }

      // 5. 删除硬盘文件（媒体文件 + Meta文件）
      try {
        const deleteResult = await globalMetaFileManager.deleteMediaFiles(mediaItemId)

        if (deleteResult.success) {
          console.log(`✅ [UnifiedMediaModule] 硬盘文件已删除: ${mediaItem.name}`)
        } else {
          console.warn(
            `⚠️ [UnifiedMediaModule] 硬盘文件删除失败: ${mediaItem.name}`,
            deleteResult.error,
          )
        }
      } catch (error) {
        console.error(`❌ [UnifiedMediaModule] 删除硬盘文件时出错: ${mediaItem.name}`, error)
        // 即使文件删除失败，也继续从内存中移除
      }

      // 6. 从数组中移除
      mediaItems.value.splice(index, 1)

      printUnifiedDebugInfo(
        '从素材库删除统一媒体项目',
        {
          mediaItemId,
          mediaItemName: mediaItem.name,
        },
        getAllMediaItems(),
      )
    }
  }

  async function removeAsset(assetId: string) {
    const mediaItem = getMediaItem(assetId)
    if (mediaItem) {
      await removeMediaItem(assetId)
      return
    }

    const index = effectTemplateAssets.value.findIndex((item) => item.id === assetId)
    if (index === -1) {
      return
    }

    const asset = effectTemplateAssets.value[index]
    await effectTemplateManager.cleanupTemplateProcessing(assetId)
    const autoSaveModule = registry.get<UnifiedAutoSaveModule>(MODULE_NAMES.AUTOSAVE)
    autoSaveModule.cleanupMediaItemWatcher(assetId)
    await cleanupRelatedEffectTemplateReferences(assetId)
    await globalMetaFileManager.deleteAssetFiles(asset)
    effectTemplateAssets.value.splice(index, 1)
  }

  /**
   * 根据ID获取媒体项目
   * @param mediaItemId 媒体项目ID（可以为null，此时返回undefined）
   * @returns 媒体项目或undefined
   */
  function getMediaItem(mediaItemId: string | null): UnifiedMediaItemData | undefined {
    if (mediaItemId === null) {
      return undefined
    }
    return mediaItems.value.find((item: UnifiedMediaItemData) => item.id === mediaItemId)
  }

  function getAsset(assetId: string | null): UnifiedLibraryAssetData | undefined {
    if (assetId === null) {
      return undefined
    }

    return (
      getMediaItem(assetId) ??
      effectTemplateAssets.value.find((item) => item.id === assetId)
    )
  }

  function getAllAssets(): UnifiedLibraryAssetData[] {
    return [...mediaItems.value, ...effectTemplateAssets.value]
  }

  /**
   * 根据数据源ID查找对应的媒体项目
   * @param sourceId 数据源ID
   * @returns 媒体项目或undefined
   */
  function getMediaItemBySourceId(sourceId: string): UnifiedMediaItemData | undefined {
    // 🌟 阶段二彻底重构：数据源不再有 id 字段
    // 此方法已废弃，保留仅为向后兼容
    console.warn('⚠️ getMediaItemBySourceId 已废弃，数据源不再有独立ID')
    return undefined
  }

  /**
   * 获取所有媒体项目
   * @returns 所有媒体项目的数组
   */
  function getAllMediaItems(): UnifiedMediaItemData[] {
    return [...mediaItems.value]
  }

  /**
   * 更新媒体项目名称
   * @param mediaItemId 媒体项目ID
   * @param newName 新名称
   */
  function updateMediaItemName(mediaItemId: string, newName: string) {
    const mediaItem = getMediaItem(mediaItemId)
    if (mediaItem) {
      UnifiedMediaItemActions.updateName(mediaItem, newName)
      void globalMetaFileManager.saveMetaFile(mediaItem)
    }
  }

  function updateAssetName(assetId: string, newName: string) {
    const asset = getAsset(assetId)
    if (!asset) return

    asset.name = newName.trim()
    void globalMetaFileManager.saveMetaFile(asset)
  }

  /**
   * 更新媒体项目
   * @param updatedMediaItem 更新后的媒体项目
   */
  function updateMediaItem(updatedMediaItem: UnifiedMediaItemData) {
    const index = mediaItems.value.findIndex(
      (item: UnifiedMediaItemData) => item.id === updatedMediaItem.id,
    )
    if (index !== -1) {
      mediaItems.value[index] = updatedMediaItem
      console.log(`统一媒体项目已更新: ${updatedMediaItem.id} -> ${updatedMediaItem.name}`)
    }
  }

  /**
   * 更新媒体项的元数据
   * @param mediaId 媒体项目ID
   * @param metadata 元数据（部分更新）
   */
  function updateMediaItemMetadata(
    mediaId: string,
    metadata: Partial<UnifiedMediaItemMetadata>,
  ) {
    const mediaItem = getMediaItem(mediaId)
    if (!mediaItem) return

    // 初始化 metadata 对象（如果不存在）
    if (!mediaItem.metadata) {
      mediaItem.metadata = {}
    }

    // 合并元数据
    mediaItem.metadata = {
      ...mediaItem.metadata,
      ...metadata,
    }

    console.log(`✅ [UnifiedMediaModule] 媒体项元数据已更新: ${mediaItem.name}`)
  }

  // ==================== 分辨率管理方法 ====================

  /**
   * 获取视频原始分辨率
   * @param mediaItemId 素材ID（可以为null，此时返回默认分辨率）
   * @returns 视频分辨率对象
   */
  function getVideoOriginalResolution(mediaItemId: string | null): { width: number; height: number } {
    const mediaItem = getMediaItem(mediaItemId)
    if (mediaItem && mediaItem.mediaType === 'video' && mediaItem.runtime.bunny) {
      const size = MediaItemQueries.getOriginalSize(mediaItem)
      if (size) {
        return size
      }
    }
    // 默认分辨率
    return { width: -1, height: -1 }
  }

  /**
   * 获取图片原始分辨率
   * @param mediaItemId 素材ID（可以为null，此时返回默认分辨率）
   * @returns 图片分辨率对象
   */
  function getImageOriginalResolution(mediaItemId: string | null): { width: number; height: number } {
    const mediaItem = getMediaItem(mediaItemId)
    if (mediaItem && mediaItem.mediaType === 'image' && mediaItem.runtime.bunny) {
      const size = MediaItemQueries.getOriginalSize(mediaItem)
      if (size) {
        return size
      }
    }
    // 默认分辨率
    return { width: -1, height: -1 }
  }

  // ==================== 媒体 ready JobRuntime 兼容层 ====================

  function getMediaReadyResourceId(mediaId: string): string {
    return getResourceId('media-ready', mediaId)
  }

  function registerMediaReadyResolver() {
    if (mediaReadyResolverRegistered) return

    jobRuntime.registerResolver(
      new MediaReadyResolver({
        getMediaItem,
        getProcessor(sourceType) {
          return getDataSourceRegistry().getProcessor(sourceType)
        },
      }),
    )
    jobRuntime.registerResolver(new MediaFileAvailableResolver({ getMediaItem }))
    jobRuntime.registerResolver(new MediaDecodedResolver({ getMediaItem }))
    mediaReadyResolverRegistered = true
  }

  function ensureMediaReady(mediaId: string): Promise<UnifiedMediaItemData> {
    registerMediaReadyResolver()

    return jobRuntime.ensure<UnifiedMediaItemData>({
      type: 'media-ready',
      key: mediaId,
      input: { mediaId },
      bindings: [{ type: 'media-item', id: mediaId }],
      policy: { queue: 'local-heavy' },
    })
  }

  function getMediaReadyTaskView(): TaskViewItem[] {
    return jobRuntime.getTaskView().filter((item) => item.type === 'media-ready')
  }

  function subscribeMediaReadyTaskView(listener: (items: TaskViewItem[]) => void): () => void {
    return jobRuntime.subscribe(() => {
      listener(getMediaReadyTaskView())
    })
  }

  function getJobTaskView(): TaskViewItem[] {
    return jobRuntime.getTaskView()
  }

  function subscribeJobTaskView(listener: (items: TaskViewItem[]) => void): () => void {
    return jobRuntime.subscribe(() => {
      listener(getJobTaskView())
    })
  }

  async function cancelJobTask(resourceId: string): Promise<boolean> {
    return jobRuntime.cancel(resourceId)
  }

  async function retryJobTask(resourceId: string): Promise<unknown> {
    return jobRuntime.retry(resourceId)
  }

  function startMediaProcessingWithLegacyProcessor(mediaItem: UnifiedMediaItemData): boolean {
    const dsRegistry = getDataSourceRegistry()
    const processor = dsRegistry.getProcessor(mediaItem.source.type)

    if (processor) {
      processor.addTask(mediaItem)
      console.log(`📋 [UnifiedMediaModule] 任务已加入旧 processor 队列`)
      return true
    }

    console.error(`❌ [UnifiedMediaModule] 找不到对应的数据源处理器: ${mediaItem.source.type}`)
    UnifiedMediaItemActions.transitionTo(mediaItem, 'error')
    return false
  }

  async function cancelMediaProcessingWithLegacyProcessor(
    mediaItem: UnifiedMediaItemData,
  ): Promise<boolean> {
    const dsRegistry = getDataSourceRegistry()
    const processor = dsRegistry.getProcessor(mediaItem.source.type)

    if (!processor) {
      console.error(`❌ [UnifiedMediaModule] 找不到对应的数据源处理器: ${mediaItem.source.type}`)
      return false
    }

    return processor.cancelTask(mediaItem.id)
  }

  async function saveProjectAfterMediaProcessingCancel() {
    const projectModule = registry.get<UnifiedProjectModule>(MODULE_NAMES.PROJECT)
    if (projectModule) {
      await projectModule.saveCurrentProject({ contentChanged: true })
    }
  }

  // ==================== 异步等待方法 ====================

  /**
   * 等待媒体项目解析完成
   * 使用Vue的watch机制监听status状态变化，更符合响应式编程模式
   * @param mediaItemId 媒体项目ID
   * @returns Promise<boolean> 解析成功返回true，解析失败抛出错误
   */
  async function waitForMediaItemReady(mediaItemId: string): Promise<boolean> {
    const mediaItem = getMediaItem(mediaItemId)

    if (!mediaItem) {
      return Promise.reject(new Error(`找不到媒体项目: ${mediaItemId}`))
    }

    try {
      await ensureMediaReady(mediaItemId)
      return true
    } catch (error) {
      JobLogger.error('MediaReady', 'media-ready:wait-failed', {
        resourceId: getMediaReadyResourceId(mediaItemId),
        type: 'media-ready',
        key: mediaItemId,
        error,
      })
      throw error
    }
  }

  // ==================== 数据源状态同步方法 ====================
  // 注意：handleSourceStatusChange方法已移除，现在由各个管理器直接处理媒体状态

  /**
   * 开始媒体项目处理流程
   * @param mediaItem 媒体项目
   */
  function startMediaProcessing(mediaItem: UnifiedMediaItemData) {
    console.log(`🚀 [UnifiedMediaModule] 开始处理媒体项目: ${mediaItem.name}`)

    // 🌟 为 mediaItem 设置 watch（监听 name 和 metadata 变化）
    const autoSaveModule = registry.get<UnifiedAutoSaveModule>(MODULE_NAMES.AUTOSAVE)
    autoSaveModule.setupMediaItemWatcher(mediaItem)

    try {
      void ensureMediaReady(mediaItem.id).catch((error) => {
        JobLogger.error('MediaReady', 'media-ready:start-failed', {
          resourceId: getMediaReadyResourceId(mediaItem.id),
          type: 'media-ready',
          key: mediaItem.id,
          error,
        })
      })

      JobLogger.info('MediaReady', 'media-ready:queued', {
        resourceId: getMediaReadyResourceId(mediaItem.id),
        type: 'media-ready',
        key: mediaItem.id,
        bindings: [{ type: 'media-item', id: mediaItem.id }],
      })
    } catch (error) {
      JobLogger.error('MediaReady', 'media-ready:fallback-legacy-start', {
        resourceId: getMediaReadyResourceId(mediaItem.id),
        type: 'media-ready',
        key: mediaItem.id,
        error,
      })
      startMediaProcessingWithLegacyProcessor(mediaItem)
    }
  }

  /**
   * 取消媒体处理任务
   * @param mediaId 媒体项目ID
   * @returns 是否成功取消
   */
  async function cancelMediaProcessing(mediaId: string): Promise<boolean> {
    const mediaItem = getMediaItem(mediaId)
    if (!mediaItem) {
      console.warn(`⚠️ [UnifiedMediaModule] 媒体项目不存在: ${mediaId}`)
      return false
    }

    console.log(`🛑 [UnifiedMediaModule] 尝试取消媒体处理: ${mediaItem.name}`)

    try {
      const resourceId = getMediaReadyResourceId(mediaId)
      let success = await jobRuntime.cancel(resourceId)

      if (!success) {
        JobLogger.warn('MediaReady', 'media-ready:fallback-legacy-cancel', {
          resourceId,
          type: 'media-ready',
          key: mediaId,
          status: mediaItem.mediaStatus,
        })
        success = await cancelMediaProcessingWithLegacyProcessor(mediaItem)
      }

      if (success) {
        console.log(`✅ [UnifiedMediaModule] 任务取消成功: ${mediaItem.name}`)
        await saveProjectAfterMediaProcessingCancel()
      } else {
        console.warn(`⚠️ [UnifiedMediaModule] 任务取消失败: ${mediaItem.name}`)
      }

      return success
    } catch (error) {
      console.error(`❌ [UnifiedMediaModule] 取消任务时出错: ${mediaItem.name}`, error)
      return false
    }
  }

  function createTransitionTemplatePlaceholder(params: {
    templateId: string
    name: string
    catalogVersion?: string
  }): EffectTemplateAssetData {
    return effectTemplateManager.createTransitionTemplatePlaceholder(params)
  }

  function createFilterTemplatePlaceholder(params: {
    templateId: string
    name: string
    catalogVersion?: string
  }): EffectTemplateAssetData {
    return effectTemplateManager.createFilterTemplatePlaceholder(params)
  }

  async function startTemplateProcessing(assetId: string): Promise<void> {
    await effectTemplateManager.startTemplateProcessing(assetId)
  }

  async function retryTemplateProcessing(assetId: string): Promise<void> {
    await effectTemplateManager.retryTemplateProcessing(assetId)
  }

  async function cancelTemplateProcessing(assetId: string): Promise<boolean> {
    return effectTemplateManager.cancelTemplateProcessing(assetId)
  }

  function getReadyEffectTemplateAssets(): EffectTemplateAssetData[] {
    return effectTemplateAssets.value.filter((item) => item.templateStatus === 'ready')
  }

  // ==================== 便捷查询方法 ====================

  /**
   * 获取就绪的媒体项目
   */
  function getReadyMediaItems(): UnifiedMediaItemData[] {
    return mediaItems.value.filter(MediaItemQueries.isReady)
  }

  /**
   * 获取正在处理的媒体项目
   */
  function getProcessingMediaItems(): UnifiedMediaItemData[] {
    return mediaItems.value.filter(MediaItemQueries.isProcessing)
  }

  /**
   * 获取有错误的媒体项目
   */
  function getErrorMediaItems(): UnifiedMediaItemData[] {
    return mediaItems.value.filter(MediaItemQueries.hasAnyError)
  }

  /**
   * 根据媒体类型筛选项目
   */
  function getMediaItemsByType(mediaType: MediaType | 'unknown'): UnifiedMediaItemData[] {
    return mediaItems.value.filter((item) => item.mediaType === mediaType)
  }

  /**
   * 根据数据源类型筛选项目
   */
  function getMediaItemsBySourceType(sourceType: string): UnifiedMediaItemData[] {
    return mediaItems.value.filter((item) => item.source.type === sourceType)
  }

  /**
   * 获取媒体项目统计信息
   */
  function getMediaItemsStats() {
    const total = mediaItems.value.length
    const ready = getReadyMediaItems().length
    const processing = getProcessingMediaItems().length
    const error = getErrorMediaItems().length
    const pending = mediaItems.value.filter(MediaItemQueries.isPending).length

    return {
      total,
      ready,
      processing,
      error,
      pending,
      readyPercentage: total > 0 ? Math.round((ready / total) * 100) : 0,
    }
  }

  // ==================== 清理方法 ====================

  /**
   * 清理与媒体项目相关的时间轴项目
   * @param mediaItemId 媒体项目ID
   */
  async function cleanupRelatedTimelineItems(mediaItemId: string): Promise<void> {
    try {
      // 通过 registry 获取时间轴模块
      const timelineModule = registry.get<UnifiedTimelineModule>(MODULE_NAMES.TIMELINE)

      if (!timelineModule) {
        console.warn('⚠️ 时间轴模块未初始化，跳过时间轴项目清理')
        return
      }

      // 获取所有时间轴项目
      const timelineItems = timelineModule.timelineItems.value

      // 找出使用该素材的所有时间轴项目
      const relatedTimelineItems = timelineItems.filter(
        (item: UnifiedTimelineItemData) => item.mediaItemId === mediaItemId,
      )

      // 清理每个相关的时间轴项目
      for (const timelineItem of relatedTimelineItems) {
        console.log(`🧹 清理时间轴项目: ${timelineItem.id}`)
        await timelineModule.removeTimelineItem(timelineItem.id)
      }

      console.log(`✅ 已清理 ${relatedTimelineItems.length} 个相关时间轴项目`)
    } catch (error) {
      console.error(`❌ 清理相关时间轴项目失败: ${mediaItemId}`, error)
    }
  }

  async function cleanupRelatedEffectTemplateReferences(assetId: string): Promise<void> {
    try {
      const timelineModule = registry.get<UnifiedTimelineModule>(MODULE_NAMES.TIMELINE)

      if (!timelineModule) {
        console.warn('⚠️ 时间轴模块未初始化，跳过效果模板引用清理')
        return
      }

      const relatedTransitionItems = timelineModule.timelineItems.value.filter(
        (item: UnifiedTimelineItemData) => item.transitionOut?.assetId === assetId,
      )

      for (const timelineItem of relatedTransitionItems) {
        timelineModule.setTimelineItemTransitionOutForCmd(timelineItem.id, undefined)
      }

      const relatedFilterItems = timelineModule.timelineItems.value.filter(
        (item: UnifiedTimelineItemData) => item.filterEffect?.assetId === assetId,
      )

      for (const timelineItem of relatedFilterItems) {
        clearChannelKeyframes(timelineItem, 'filter.intensity')
        timelineModule.setTimelineItemFilterEffectForCmd(timelineItem.id, undefined)
      }

      if (relatedTransitionItems.length > 0 || relatedFilterItems.length > 0) {
        console.log(
          `🧹 已清理效果素材引用: 转场 ${relatedTransitionItems.length} 个, 滤镜 ${relatedFilterItems.length} 个`,
        )
      }
    } catch (error) {
      console.error(`❌ 清理效果素材引用失败: ${assetId}`, error)
    }
  }


  return {
    // 状态
    mediaItems,
    effectTemplateAssets,

    // 媒体项目管理方法
    addMediaItem,
    removeMediaItem,
    getMediaItem,
    getMediaItemBySourceId,
    updateMediaItemName,
    updateMediaItem,
    updateMediaItemMetadata,
    getAllMediaItems,
    addAsset,
    removeAsset,
    getAsset,
    getAllAssets,
    updateAssetName,
    createTransitionTemplatePlaceholder,
    createFilterTemplatePlaceholder,
    startTemplateProcessing,
    retryTemplateProcessing,
    cancelTemplateProcessing,
    getReadyEffectTemplateAssets,

    // 分辨率管理方法
    getVideoOriginalResolution,
    getImageOriginalResolution,

    // 异步等待方法
    waitForMediaItemReady,
    ensureMediaReady,
    getMediaReadyResourceId,
    getMediaReadyTaskView,
    subscribeMediaReadyTaskView,
    getJobTaskView,
    subscribeJobTaskView,
    cancelJobTask,
    retryJobTask,

    // 数据源处理方法
    startMediaProcessing,
    cancelMediaProcessing,

    // 便捷查询方法
    getReadyMediaItems,
    getProcessingMediaItems,
    getErrorMediaItems,
    getMediaItemsByType,
    getMediaItemsBySourceType,
    getMediaItemsStats,

    // 清理方法
    cleanupRelatedTimelineItems,
    cleanupRelatedEffectTemplateReferences,

    // 工厂函数和查询函数
    createUnifiedMediaItemData,
    MediaItemQueries,
    UnifiedMediaItemActions,
  }
}

// 导出类型定义
export type UnifiedMediaModule = ReturnType<typeof createUnifiedMediaModule>
