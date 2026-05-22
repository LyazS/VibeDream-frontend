import { ref, computed, type Ref } from 'vue'
import type { UnifiedProjectConfig, UnifiedProjectTimeline } from '@/core/project/types'
import type { UnifiedDirectoryConfig } from '@/core/directory/types'
import { ProjectFileOps } from '@/core/utils'
import { TimelineItemFactory } from '@/core/timelineitem/factory'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { UnifiedTrackData, UnifiedTrackType } from '@/core/track/TrackTypes'
import { createUnifiedTrackData } from '@/core/track/TrackTypes'
import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'
import { globalMediaItemLoader } from '@/core/managers/media/MediaItemLoader'
import { isEffectTemplateAsset, isMediaAsset } from '@/core/asset/types'
import { useProjectThumbnailService } from '@/core/composables/useProjectThumbnailService'
import { MediaSync } from '@/core/managers/sync'
import { framesToSeconds } from '@/core/utils/timeUtils'
import { useAppI18n } from '@/core/composables/useI18n'
import { i18n } from '@/locales'
import { ModuleRegistry, MODULE_NAMES } from './ModuleRegistry'
import type { UnifiedConfigModule } from './UnifiedConfigModule'
import type { UnifiedTimelineModule } from './UnifiedTimelineModule'
import type { UnifiedTrackModule } from './UnifiedTrackModule'
import type { UnifiedMediaModule } from './UnifiedMediaModule'
import type { UnifiedMediaBunnyModule } from './UnifiedMediaBunnyModule'
import type { UnifiedDirectoryModule } from './UnifiedDirectoryModule'
import type { UnifiedAutoSaveModule } from './UnifiedAutoSaveModule'

/**
 * 统一项目管理模块
 * 基于新架构统一类型系统的项目管理，参考原projectModule设计
 */
export function createUnifiedProjectModule(registry: ModuleRegistry) {
  // 通过注册中心获取依赖模块
  const configModule = registry.get<UnifiedConfigModule>(MODULE_NAMES.CONFIG)
  const timelineModule = registry.get<UnifiedTimelineModule>(MODULE_NAMES.TIMELINE)
  const trackModule = registry.get<UnifiedTrackModule>(MODULE_NAMES.TRACK)
  const mediaModule = registry.get<UnifiedMediaModule>(MODULE_NAMES.MEDIA)
  const directoryModule = registry.get<UnifiedDirectoryModule>(MODULE_NAMES.DIRECTORY)
  const thumbnailService = useProjectThumbnailService()

  // 获取i18n函数
  const { t } = useAppI18n()

  // ==================== 状态定义 ====================

  // 项目保存状态
  const isSaving = ref(false)

  // 项目加载状态
  const isLoading = ref(false)

  // 项目设置预加载状态
  const isProjectSettingsReady = ref(false)

  // 项目内容加载状态
  const isProjectTimelineReady = ref(false)

  // 加载进度状态
  const loadingProgress = ref(0) // 0-100
  const loadingStage = ref('') // 当前加载阶段
  const loadingDetails = ref('') // 详细信息
  
  // 🌟 项目加载时的MediaSync实例数组（批量优化）
  const projectLoadMediaSyncs: MediaSync[] = []
  let ensureMediaReadyForProjectLoad: ((mediaId: string) => Promise<unknown>) | null = null

  // ==================== 计算属性 ====================
  /**
   * 项目保存状态文本（支持多语言）
   */
  const projectStatus = computed(() => {
    if (isSaving.value) return t('editor.savingStatus')

    // 格式化时间为 HH:MM:SS
    const lastSaved = new Date(configModule.projectUpdatedAt.value)
    const timeString = lastSaved.toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    return t('editor.savedAt', { time: timeString })
  })

  /**
   * 是否正在显示加载进度
   */
  const showLoadingProgress = computed(() => {
    return isLoading.value && loadingProgress.value >= 0
  })

  // ==================== 项目管理方法 ====================

  /**
   * 更新加载进度
   * @param stage 当前阶段
   * @param progress 进度百分比 (0-100)
   * @param details 详细信息（可选）
   */
  function updateLoadingProgress(stage: string, progress: number, details?: string): void {
    loadingStage.value = stage
    loadingProgress.value = Math.max(0, Math.min(100, progress))
    loadingDetails.value = details || ''
    console.log(`📊 加载进度: ${stage} (${progress}%)${details ? ` - ${details}` : ''}`)
  }

  function setMediaReadyEnsurer(ensurer: (mediaId: string) => Promise<unknown>): void {
    ensureMediaReadyForProjectLoad = ensurer
  }

  /**
   * 重置加载状态
   * @param delay 延迟时间（毫秒），默认300ms
   */
  function resetLoadingState(delay: number = 300): void {
    if (delay > 0) {
      // 延迟重置，让用户看到加载完成的状态
      setTimeout(() => {
        isLoading.value = false
        loadingProgress.value = 0
        loadingStage.value = ''
        loadingDetails.value = ''
      }, delay)
    } else {
      // 立即重置
      isLoading.value = false
      loadingProgress.value = 0
      loadingStage.value = ''
      loadingDetails.value = ''
    }
  }

  /**
   * 保存当前项目
   * @param options 保存选项
   */
  /**
   * 保存当前项目（增强版）
   * @param options 保存选项
   */
  async function saveCurrentProject(options?: {
    configChanged?: boolean
    contentChanged?: boolean
    directoryChanged?: boolean // 🆕 新增目录变更选项
  }): Promise<void> {
    try {
      isSaving.value = true
      console.log(`💾 保存项目: ${configModule.projectName.value}`)
      configModule.projectUpdatedAt.value = new Date().toISOString()

      // 解构保存选项
      const {
        configChanged = false,
        contentChanged = false,
        directoryChanged = false, // 🆕 新增
      } = options || {}

      // 保存项目配置（不再包含目录）
      let updatedProjectConfig: UnifiedProjectConfig | undefined
      if (configChanged) {
        // 计算项目时长
        let calculatedDuration = 0
        if (timelineModule.timelineItems.value.length > 0) {
          const maxEndTime = Math.max(
            ...timelineModule.timelineItems.value.map((item) => item.timeRange.timelineEndTime),
          )
          calculatedDuration = framesToSeconds(maxEndTime)
        }

        updatedProjectConfig = {
          id: configModule.projectId.value,
          name: configModule.projectName.value,
          description: configModule.projectDescription.value,
          createdAt: configModule.projectCreatedAt.value,
          updatedAt: configModule.projectUpdatedAt.value,
          version: configModule.projectVersion.value,
          duration: calculatedDuration,
          settings: {
            videoResolution: configModule.videoResolution.value,
            timelineDurationFrames: configModule.timelineDurationFrames.value,
          },
          // ❌ 移除目录配置部分
        }
      }

      // 保存项目内容
      let updatedProjectTimeline: UnifiedProjectTimeline | undefined
      if (contentChanged) {
        updatedProjectTimeline = {
          tracks: trackModule.tracks.value,
          timelineItems: timelineModule.timelineItems.value.map((item) => {
            const clonedItem = TimelineItemFactory.clone(item)
            if (clonedItem.runtime) {
              // 清空运行时数据，但保留 isInitialized 字段（必选）
              clonedItem.runtime = {
                isInitialized: clonedItem.runtime.isInitialized,
              }
            }
            return clonedItem
          }),
        }
      }

      // 构建目录配置
      let updatedDirectoryConfig: UnifiedDirectoryConfig | undefined
      if (directoryChanged) {
        updatedDirectoryConfig = {
          directories: Array.from(directoryModule.directories.value.values()),
          openTabs: directoryModule.openTabs.value,
          activeTabId: directoryModule.activeTabId.value,
          viewMode: directoryModule.viewMode.value,
          sortBy: directoryModule.sortBy.value,
          sortOrder: directoryModule.sortOrder.value,
        }
      }

      // 调用项目文件操作工具进行智能保存（包含目录配置）
      await ProjectFileOps.saveProject(
        configModule.projectId.value,
        updatedProjectConfig,
        updatedProjectTimeline,
        updatedDirectoryConfig, // 🆕 将目录配置也传入
        options,
      )

      console.log(`✅ 项目保存成功: ${configModule.projectName.value}`)

      // 异步启动缩略图生成
      if (configChanged && timelineModule.timelineItems.value.length > 0) {
        thumbnailService
          .generateProjectThumbnail(
            configModule.projectId.value,
            timelineModule.timelineItems.value,
            mediaModule,
          )
          .catch((error) => {
            console.warn('缩略图生成失败:', error)
          })
      }
    } catch (error) {
      console.error('保存项目失败:', error)
      throw error
    } finally {
      isSaving.value = false
    }
  }

  /**
   * 预加载项目设置（轻量级，只加载关键配置）
   * @param projectId 项目ID
   */
  async function preloadProjectSettings(projectId: string): Promise<void> {
    try {
      console.log(`🔧 [Settings Preload] 开始预加载项目设置: ${projectId}`)

      // 使用项目文件操作工具加载配置
      const projConfig = await ProjectFileOps.loadProjectConfig(projectId)
      if (!projConfig) {
        console.error('❌ [Settings Preload] 预加载项目设置失败：项目配置不存在')
        throw new Error('项目配置不存在')
      }
      // 恢复配置到configModule
      configModule.restoreFromProjectSettings(projectId, projConfig)

      // 🆕 加载目录配置并恢复状态（支持 null，内部会初始化默认目录）
      const directoryConfig = await ProjectFileOps.loadDirectoryConfig(projectId)
      directoryModule.restoreFromProjectSettings(directoryConfig)

      console.log('🔄 [LIFECYCLE] UnifiedProjectModule 项目设置预加载成功')
      isProjectSettingsReady.value = true
      console.log('🔄 [LIFECYCLE] UnifiedProjectModule isProjectSettingsReady 设置为 true')
    } catch (error) {
      console.error('❌ [Settings Preload] 预加载项目设置失败:', error)
      isProjectSettingsReady.value = false
      throw new Error(
        `项目设置加载失败，无法继续: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * 加载项目内容（媒体文件、时间轴数据等）
   * @param projectId 项目ID
   */
  async function loadProjectContent(projectId: string): Promise<void> {
    try {
      isLoading.value = true
      updateLoadingProgress(t('project.progress.startContent'), 5)
      console.log(`📂 [Content Load] 开始加载项目内容: ${projectId}`)

      // 1. 加载项目内容数据
      updateLoadingProgress(t('project.progress.contentData'), 10)
      const projectTimeline = await ProjectFileOps.loadProjectTimeline(projectId)
      if (!projectTimeline) {
        throw new Error('项目内容不存在')
      }

      // 2. 初始化 globalMetaFileManager（内部包含扫描媒体目录逻辑）
      updateLoadingProgress(t('project.progress.mediaManager'), 20)
      await globalMetaFileManager.initialize(projectId)

      // 3. 🌟 阶段二：从 Meta 文件构建媒体项目（传入 projectTimeline）
      updateLoadingProgress(t('project.progress.rebuildMedia'), 50)
      await rebuildMediaItems(projectTimeline)

      // 4. 恢复轨道状态
      updateLoadingProgress(t('project.progress.restoreTracks'), 70)
      await restoreTracks(projectTimeline.tracks)

      // 5. 恢复时间轴项目状态
      updateLoadingProgress(t('project.progress.restoreTimeline'), 90)
      await restoreTimelineItems(projectTimeline.timelineItems)

      updateLoadingProgress(t('project.progress.contentComplete'), 100)
      isProjectTimelineReady.value = true
      const mediabunnyModule = registry.get<UnifiedMediaBunnyModule>(MODULE_NAMES.MEDIABUNNY)
      mediabunnyModule.seekToFrame(0)
    } catch (error) {
      console.error('❌ [Content Load] 加载项目内容失败:', error)
      throw error
    } finally {
      resetLoadingState()
    }
  }

  /**
   * 重建媒体项目（延迟加载优化版）
   *
   * 🌟 只从 Meta 文件加载，不再支持旧项目格式
   * Meta 文件是唯一真相源
   *
   * 🚀 优化：只启动时间轴使用的媒体 + 当前活动目录的媒体
   */
  async function rebuildMediaItems(projectTimeline: UnifiedProjectTimeline): Promise<void> {
    try {
      if (!mediaModule) {
        throw new Error('媒体模块未初始化')
      }

      console.log('📄 [rebuildMediaItems] 从 Meta 文件加载媒体项目（延迟加载版）')

      // 从 Meta 文件加载所有媒体项目（唯一真相源）
      const metaMediaItems = await globalMediaItemLoader.loadMediaItemsFromMeta(
        configModule.projectId.value,
      )

      if (metaMediaItems.length === 0) {
        console.log('📄 [rebuildMediaItems] 未发现任何 Meta 文件，项目为空')
        return
      }

      console.log(`📄 [rebuildMediaItems] 从 Meta 文件加载了 ${metaMediaItems.length} 个媒体项目`)

      // 🆕 步骤1: 统计每个素材的引用计数
      const refCountMap = new Map<string, number>()

      // 遍历所有目录，统计每个素材被引用的次数
      directoryModule.directories.value.forEach((dir) => {
        dir.assetIds.forEach((mediaId) => {
          refCountMap.set(mediaId, (refCountMap.get(mediaId) || 0) + 1)
        })
      })

      console.log(`📊 [rebuildMediaItems] 引用计数统计完成，共 ${refCountMap.size} 个素材被引用`)

      // 🆕 步骤2: 为每个媒体项目设置引用计数
      for (const mediaItem of metaMediaItems) {
        mediaItem.runtime.refCount = refCountMap.get(mediaItem.id) || 0

        // 如果引用计数为0，标记为孤立素材
        if (mediaItem.runtime.refCount === 0) {
          console.warn(
            `⚠️ [rebuildMediaItems] 发现孤立素材: ${mediaItem.name} (ID: ${mediaItem.id})`,
          )
        }
      }

      // 收集需要立即启动的媒体ID
      const immediateLoadIds = new Set<string>()

      // 1. 收集时间轴使用的媒体ID（从传入的 projectTimeline 获取）
      projectTimeline.timelineItems.forEach((item) => {
        if (item.mediaItemId) {
          immediateLoadIds.add(item.mediaItemId)
        }
      })

      // 2. 收集当前活动目录的媒体ID（包括角色类型子文件夹中的媒体）
      const activeTabId = directoryModule.activeTabId.value
      if (activeTabId) {
        const activeTab = directoryModule.openTabs.value.find((tab) => tab.id === activeTabId)
        if (activeTab) {
          const activeDir = directoryModule.directories.value.get(activeTab.dirId)
          if (activeDir) {
            // 收集当前目录的媒体ID
            activeDir.assetIds.forEach((id) => immediateLoadIds.add(id))

            // 收集角色类型子文件夹中的媒体ID
            activeDir.childDirIds.forEach((childDirId) => {
              const childDir = directoryModule.directories.value.get(childDirId)
              if (childDir && directoryModule.isCharacterDirectory(childDir)) {
                childDir.assetIds.forEach((id) => immediateLoadIds.add(id))
              }
            })
          }
        }
      }

      console.log(`📊 [rebuildMediaItems] 需要立即加载 ${immediateLoadIds.size} 个媒体项目`)

      // 添加媒体项目并选择性启动
      let immediateCount = 0
      let deferredCount = 0

      for (const mediaItem of metaMediaItems) {
        mediaModule.addAsset(mediaItem)

        if (immediateLoadIds.has(mediaItem.id)) {
          if (isMediaAsset(mediaItem) && mediaItem.mediaStatus === 'pending') {
            if (ensureMediaReadyForProjectLoad) {
              void ensureMediaReadyForProjectLoad(mediaItem.id).catch((error) => {
                console.error(
                  `❌ [rebuildMediaItems] 立即加载媒体失败，已跳过: ${mediaItem.name}`,
                  error,
                )
              })
            } else {
              console.warn(
                `⚠️ [rebuildMediaItems] ensureMediaReady 未初始化，跳过立即加载: ${mediaItem.name}`,
              )
            }
            immediateCount++
            continue
          }

          if (
            isEffectTemplateAsset(mediaItem) &&
            ['pending', 'missing'].includes(mediaItem.templateStatus)
          ) {
            void mediaModule.startTemplateProcessing(mediaItem.id)
            immediateCount++
            continue
          }
        }

        deferredCount++
      }

      console.log(`✅ [rebuildMediaItems] 媒体项目加载完成`)
      console.log(`   - 立即加载: ${immediateCount} 个`)
      console.log(`   - 延迟加载: ${deferredCount} 个`)
    } catch (error) {
      console.error('❌ [rebuildMediaItems] 加载失败:', error)
      throw error
    }
  }

  /**
   * 恢复轨道状态（用于项目加载）
   */
  async function restoreTracks(savedTracks: UnifiedTrackData[]): Promise<void> {
    try {
      console.log('🛤️ 开始恢复轨道状态...')

      // 检查轨道模块是否可用
      if (!trackModule) {
        console.warn('⚠️ 轨道模块未初始化，跳过轨道恢复')
        return
      }

      // 清空现有轨道
      trackModule.tracks.value = []

      // 恢复轨道数据
      if (savedTracks && savedTracks.length > 0) {
        for (const trackData of savedTracks) {
          // 创建完整的轨道数据对象
          const trackToAdd = createUnifiedTrackData(trackData.type, {
            id: trackData.id, // 使用保存的轨道ID
            name: trackData.name,
            isVisible: trackData.isVisible,
            isMuted: trackData.isMuted,
            height: trackData.height,
          })

          // 使用轨道模块的 addTrack 方法添加轨道
          trackModule.addTrack(trackToAdd, undefined)

          console.log(`🛤️ 恢复轨道: ${trackData.name} (${trackData.type})`)
        }
      } else {
        // 如果没有保存的轨道，创建默认轨道
        console.log('🛤️ 没有保存的轨道数据，创建默认轨道')
        const defaultTrack = createUnifiedTrackData('video', {
          name: i18n.global.t('timeline.videoTrack'),
        })
        trackModule.addTrack(defaultTrack)
      }

      console.log(`✅ 轨道恢复完成: ${trackModule.tracks.value.length}个轨道`)
    } catch (error) {
      console.error('❌ 恢复轨道失败:', error)
      throw error
    }
  }

  /**
   * 恢复时间轴项目状态（用于项目加载）
   */
  async function restoreTimelineItems(
    savedTimelineItems: UnifiedTimelineItemData[],
  ): Promise<void> {
    try {
      console.log('🎬 开始恢复时间轴项目状态...')

      // 检查必要模块是否可用
      if (!timelineModule) {
        console.warn('⚠️ 时间轴模块未初始化，跳过时间轴项目恢复')
        return
      }

      if (!mediaModule) {
        console.warn('⚠️ 媒体模块未初始化，跳过时间轴项目恢复')
        return
      }

      // 清空现有时间轴项目
      timelineModule.timelineItems.value = []

      // 收集所有成功重建的时间轴项目
      const rebuiltTimelineItems: UnifiedTimelineItemData[] = []

      // 恢复时间轴项目数据
      if (savedTimelineItems && savedTimelineItems.length > 0) {
        for (const itemData of savedTimelineItems) {
          try {
            // 基本验证：必须有ID
            if (!itemData.id) {
              console.warn('⚠️ 跳过无效的时间轴项目数据（缺少ID）:', itemData)
              continue
            }

            // 验证轨道是否存在
            if (
              itemData.trackId &&
              !trackModule.tracks.value.some((t) => t.id === itemData.trackId)
            ) {
              console.warn(`⚠️ 跳过时间轴项目，对应的轨道不存在: ${itemData.trackId}`)
              continue
            }

            // 🆕 占位符特殊处理：直接添加，跳过所有重建流程
            if (itemData.isPlaceholder) {
              console.log(`🔄 检测到占位符项目，直接添加: ${itemData.id}`)

              // 克隆项目数据（保持所有状态）
              const placeholderItem = TimelineItemFactory.clone(itemData)

              // 直接添加到时间轴，不需要 rebuildForCmd 和 setupTimelineItemBunny
              await timelineModule.addTimelineItem(placeholderItem)
              console.log(`✅ 占位符项目恢复完成: ${itemData.id}`)
              continue
            }

            // 文本类型特殊处理（文本类型没有对应的媒体项目，mediaItemId可以为空）
            if (itemData.mediaType !== 'text' && !itemData.mediaItemId) {
              console.warn('⚠️ 跳过无效的时间轴项目数据（缺少mediaItemId）:', itemData)
              continue
            }

            // 非文本类型：验证对应的媒体项目是否存在
            if (itemData.mediaType !== 'text' && itemData.mediaItemId) {
              const mediaItem = mediaModule.mediaItems.value.find(
                (m) => m.id === itemData.mediaItemId,
              )
              if (!mediaItem) {
                console.warn(`⚠️ 跳过时间轴项目，对应的媒体项目不存在: ${itemData.mediaItemId}`)
                continue
              }
            }

            console.log(`🔄 恢复时间轴项目：从源头重建 ${itemData.id}...`)

            // 从原始素材重新创建TimelineItem和sprite
            const rebuildResult = await TimelineItemFactory.rebuildForCmd({
              originalTimelineItemData: itemData,
              getMediaItem: mediaModule.getMediaItem,
              logIdentifier: 'restoreTimelineItems',
            })

            if (!rebuildResult.success) {
              console.error(`❌ 重建时间轴项目失败: ${itemData.id} - ${rebuildResult.error}`)
              continue
            }

            const newTimelineItem = rebuildResult.timelineItem

            // 添加到时间轴
            await timelineModule.addTimelineItem(newTimelineItem)
            
            // 收集重建的项目
            rebuiltTimelineItems.push(newTimelineItem)

            console.log(`✅ 已恢复时间轴项目: ${itemData.id} (${itemData.mediaType})`)
          } catch (error) {
            console.error(`❌ 恢复时间轴项目失败: ${itemData.id}`, error)
            // 即使单个时间轴项目恢复失败，也要继续处理其他项目
          }
        }
      }

      // 🌟 性能优化：按媒体项目分组loading状态的时间轴项目
      const loadingItemsByMedia = new Map<string, string[]>()
      
      for (const item of rebuiltTimelineItems) {
        if (item.timelineStatus === 'loading' && item.mediaItemId !== null) {
          const timelineIds = loadingItemsByMedia.get(item.mediaItemId) || []
          timelineIds.push(item.id)
          loadingItemsByMedia.set(item.mediaItemId, timelineIds)
        }
      }

      // 🌟 为每个唯一的媒体项目创建一个MediaSync（避免重复watcher）
      // 先清理旧的MediaSync实例
      projectLoadMediaSyncs.forEach(sync => sync.cleanup())
      projectLoadMediaSyncs.length = 0
      
      for (const [mediaItemId, timelineItemIds] of loadingItemsByMedia) {
        const mediaSync = new MediaSync(mediaItemId, {
          syncId: `project-load-${configModule.projectId.value}`,
          timelineItemIds: timelineItemIds,         // 传递所有相关的时间轴项目ID数组
          shouldUpdateCommand: false,                // 项目加载不需要更新命令
          description: `Project Load: ${configModule.projectId.value}`,
        })
        await mediaSync.setup()
        projectLoadMediaSyncs.push(mediaSync)  // 保存引用
      }

      timelineModule.refreshTransitionItems?.()

      console.log(`✅ 时间轴项目恢复完成: ${timelineModule.timelineItems.value.length}个项目`)
      if (loadingItemsByMedia.size > 0) {
        console.log(`📊 创建了 ${projectLoadMediaSyncs.length} 个 MediaSync 实例，监听 ${loadingItemsByMedia.size} 个媒体项目`)
      }
    } catch (error) {
      console.error('❌ 恢复时间轴项目失败:', error)
      throw error
    }
  }

  /**
   * 清除当前项目
   */
  function clearCurrentProject(): void {
    console.log('🧹 已清除当前项目')

    // 🌟 清理所有 mediaItem watchers
    const autoSaveModule = registry.get<UnifiedAutoSaveModule>(MODULE_NAMES.AUTOSAVE)
    autoSaveModule.cleanupAllMediaItemWatchers()
  }

  /**
   * 清理项目加载时的媒体同步
   */
  function cleanupProjectMediaSync(): void {
    console.log(`🗑️ 清理项目加载的 MediaSync 实例: ${projectLoadMediaSyncs.length} 个`)
    projectLoadMediaSyncs.forEach(sync => sync.cleanup())
    projectLoadMediaSyncs.length = 0
  }

  /**
   * 获取项目摘要信息
   */
  function getProjectSummary() {
    return {
      projectStatus: projectStatus.value,
      isSaving: isSaving.value,
      isLoading: isLoading.value,
    }
  }

  // ==================== 导出接口 ====================

  return {
    // 状态
    projectStatus,
    isSaving,
    isLoading,

    // 加载进度状态
    loadingProgress,
    loadingStage,
    loadingDetails,
    showLoadingProgress,
    isProjectSettingsReady,
    isProjectTimelineReady,

    // 方法
    saveCurrentProject,
    preloadProjectSettings,
    loadProjectContent,
    clearCurrentProject,
    getProjectSummary,

    // 恢复方法（拆分后的独立函数）
    restoreTracks,
    restoreTimelineItems,

    // 加载进度方法
    setMediaReadyEnsurer,
    updateLoadingProgress,
    resetLoadingState,

    // 清理方法
    cleanupProjectMediaSync,
  }
}

// 导出类型定义
export type UnifiedProjectModule = ReturnType<typeof createUnifiedProjectModule>
