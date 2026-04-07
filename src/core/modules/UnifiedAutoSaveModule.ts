import { ref, watch, type Ref, computed } from 'vue'
import { debounce, throttle } from 'lodash'
import type { ModuleRegistry } from './ModuleRegistry'
import { MODULE_NAMES } from './ModuleRegistry'
import type { UnifiedProjectModule } from './UnifiedProjectModule'
import type { UnifiedTimelineModule } from './UnifiedTimelineModule'
import type { UnifiedTrackModule } from './UnifiedTrackModule'
import type { UnifiedMediaModule } from './UnifiedMediaModule'
import type { UnifiedConfigModule } from './UnifiedConfigModule'
import type { UnifiedDirectoryModule } from './UnifiedDirectoryModule'
import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'
import type { UnifiedLibraryAssetData } from '@/core/asset/types'
import { isMediaAsset } from '@/core/asset/types'

/**
 * 自动保存配置
 */
interface AutoSaveConfig {
  debounceTime: number // 防抖时间（毫秒）
  throttleTime: number // 节流时间（毫秒）
  maxRetries: number // 最大重试次数
  enabled: boolean // 是否启用自动保存
}

/**
 * 自动保存状态
 */
interface AutoSaveState {
  isEnabled: boolean
  lastSaveTime: Date | null
  saveCount: number
  errorCount: number
  // 🔥 标记累积字段
  configChanged: boolean
  contentChanged: boolean
  directoryChanged: boolean
}

/**
 * 统一自动保存模块
 * 提供防抖+节流的自动保存策略，适配新架构的模块化设计
 */
export function createUnifiedAutoSaveModule(
  registry: ModuleRegistry,
  config: Partial<AutoSaveConfig> = {},
) {
  // 通过注册中心获取依赖模块
  const projectModule = registry.get<UnifiedProjectModule>(MODULE_NAMES.PROJECT)
  const timelineModule = registry.get<UnifiedTimelineModule>(MODULE_NAMES.TIMELINE)
  const trackModule = registry.get<UnifiedTrackModule>(MODULE_NAMES.TRACK)
  const mediaModule = registry.get<UnifiedMediaModule>(MODULE_NAMES.MEDIA)
  const configModule = registry.get<UnifiedConfigModule>(MODULE_NAMES.CONFIG)
  const directoryModule = registry.get<UnifiedDirectoryModule>(MODULE_NAMES.DIRECTORY)

  // 数据监听器配置
  const dataWatchers = {
    timelineItems: timelineModule.timelineItems,
    tracks: trackModule.tracks,
    mediaItems: mediaModule.mediaItems,
    projectConfig: computed(() => ({
      videoResolution: configModule.videoResolution.value,
      timelineDurationFrames: configModule.timelineDurationFrames.value,
    })),
    // 🆕 添加目录配置监听
    directoryConfig: computed(() => ({
      directories: directoryModule.directories.value,
      openTabs: directoryModule.openTabs.value,
      activeTabId: directoryModule.activeTabId.value,
      viewMode: directoryModule.viewMode.value,
      sortBy: directoryModule.sortBy.value,
      sortOrder: directoryModule.sortOrder.value,
    })),
  }

  // ==================== 配置管理 ====================

  // 默认配置
  const defaultConfig: AutoSaveConfig = {
    debounceTime: 2000, // 2秒防抖
    throttleTime: 30000, // 30秒强制保存
    maxRetries: 3,
    enabled: true,
  }

  const finalConfig = { ...defaultConfig, ...config }

  // ==================== 状态管理 ====================

  // 自动保存状态
  const autoSaveState = ref<AutoSaveState>({
    isEnabled: finalConfig.enabled,
    lastSaveTime: null,
    saveCount: 0,
    errorCount: 0,
    // 🔥 初始化标记累积字段
    configChanged: false,
    contentChanged: false,
    directoryChanged: false,
  })

  // lodash 节流防抖函数引用
  let debouncedSave: ReturnType<typeof debounce> | null = null
  let throttledSave: ReturnType<typeof throttle> | null = null
  let retryCount = 0

  // 监听器清理函数数组
  const unwatchFunctions: (() => void)[] = []

  // ==================== MediaItem Watch 管理 ====================

  /**
   * MediaItem Watch 管理器
   * key: mediaItemId, value: unwatch 函数
   */
  const mediaItemWatchers = new Map<string, () => void>()

  /**
   * 防抖保存函数
   * key: mediaItemId, value: 防抖函数
   */
  const mediaItemSaveDebouncers = new Map<string, ReturnType<typeof debounce>>()

  /**
   * 为单个 mediaItem 设置 watch
   * @param mediaItem 媒体项目
   */
  function setupMediaItemWatcher(mediaItem: UnifiedLibraryAssetData): void {
    // 如果已经存在 watcher，先清理
    const existingUnwatch = mediaItemWatchers.get(mediaItem.id)
    if (existingUnwatch) {
      existingUnwatch()
    }

    // 创建防抖保存函数
    const debouncedSave = debounce(async () => {
      try {
        console.log(`💾 [AutoSave] 保存 metafile: ${mediaItem.name}`)
        const success = await globalMetaFileManager.saveMetaFile(mediaItem)
        if (success) {
          console.log(`✅ [AutoSave] metafile 保存成功: ${mediaItem.name}`)
        } else {
          console.warn(`⚠️ [AutoSave] metafile 保存失败: ${mediaItem.name}`)
        }
      } catch (error) {
        console.error(`❌ [AutoSave] metafile 保存失败: ${mediaItem.name}`, error)
      }
    }, 1000) // 1秒防抖

    // 保存防抖函数
    mediaItemSaveDebouncers.set(mediaItem.id, debouncedSave)

    // 创建 watch
    const unwatch = watch(
      () => ({
        name: mediaItem.name,
        metadata: isMediaAsset(mediaItem) ? mediaItem.metadata : undefined,
        templatePayload: !isMediaAsset(mediaItem) ? mediaItem.templatePayload : undefined,
      }),
      (newValues, oldValues) => {
        // 检查是否有变化
        const nameChanged = newValues.name !== oldValues.name
        const metadataChanged =
          JSON.stringify(newValues.metadata) !== JSON.stringify(oldValues.metadata)
        const templatePayloadChanged =
          JSON.stringify(newValues.templatePayload) !== JSON.stringify(oldValues.templatePayload)

        if (nameChanged || metadataChanged || templatePayloadChanged) {
          console.log(`📝 [AutoSave] 检测到 mediaItem 变化: ${mediaItem.id}`, {
            nameChanged,
            metadataChanged,
            templatePayloadChanged,
            oldName: oldValues.name,
            newName: newValues.name,
          })
          // 触发防抖保存
          debouncedSave()
        }
      },
      { deep: true }
    )

    // 保存 unwatch 函数
    mediaItemWatchers.set(mediaItem.id, unwatch)
    console.log(`👀 [AutoSave] 已设置 mediaItem watcher: ${mediaItem.id}`)
  }

  /**
   * 清理单个 mediaItem 的 watch
   * @param mediaItemId 媒体项目ID
   */
  function cleanupMediaItemWatcher(mediaItemId: string): void {
    // 清理 watch
    const unwatch = mediaItemWatchers.get(mediaItemId)
    if (unwatch) {
      unwatch()
      mediaItemWatchers.delete(mediaItemId)
      console.log(`🧹 [AutoSave] 已清理 mediaItem watcher: ${mediaItemId}`)
    }

    // 清理防抖函数
    const debouncedSave = mediaItemSaveDebouncers.get(mediaItemId)
    if (debouncedSave) {
      debouncedSave.cancel()
      mediaItemSaveDebouncers.delete(mediaItemId)
    }
  }

  /**
   * 清理所有 mediaItem 的 watch
   */
  function cleanupAllMediaItemWatchers(): void {
    console.log(`🧹 [AutoSave] 清理所有 mediaItem watchers，共 ${mediaItemWatchers.size} 个`)

    // 清理所有 watch
    mediaItemWatchers.forEach((unwatch, mediaItemId) => {
      unwatch()
    })
    mediaItemWatchers.clear()

    // 清理所有防抖函数
    mediaItemSaveDebouncers.forEach((debouncedSave) => {
      debouncedSave.cancel()
    })
    mediaItemSaveDebouncers.clear()

    console.log(`✅ [AutoSave] 所有 mediaItem watchers 已清理`)
  }

  // ==================== 内部方法 ====================

  /**
   * 初始化节流防抖函数
   * 🔥 改进：不再接收 options 参数，使用累积的标记
   */
  function initializeDebounceThrottle() {
    // 清除现有的函数
    clearTimers()

    // 创建新的防抖函数（不再接收参数）
    debouncedSave = debounce(() => {
      performSave()
    }, finalConfig.debounceTime)

    // 创建新的节流函数（不再接收参数）
    throttledSave = throttle(
      () => {
        // 检查是否有任何待保存的变化
        if (
          autoSaveState.value.configChanged ||
          autoSaveState.value.contentChanged ||
          autoSaveState.value.directoryChanged
        ) {
          console.log('⏰ [AutoSave] 节流触发强制保存')
          performSave()
        }
      },
      finalConfig.throttleTime,
      { leading: false, trailing: true },
    )
  }

  /**
   * 清除所有定时器
   */
  function clearTimers() {
    debouncedSave?.cancel()
    throttledSave?.cancel()
    debouncedSave = null
    throttledSave = null
  }

  /**
   * 执行保存操作
   * 🔥 改进：使用累积的标记，保存后清空标记
   */
  async function performSave(): Promise<boolean> {
    if (projectModule.isSaving.value) {
      console.log('🔄 [AutoSave] 正在保存中，跳过此次自动保存')
      return false
    }

    try {
      // 🔥 核心改进：读取累积的标记
      const saveOptions = {
        configChanged: autoSaveState.value.configChanged,
        contentChanged: autoSaveState.value.contentChanged,
        directoryChanged: autoSaveState.value.directoryChanged,
      }

      console.log('💾 [AutoSave] 开始自动保存...', saveOptions)

      await projectModule.saveCurrentProject(saveOptions)

      // 更新状态
      autoSaveState.value.lastSaveTime = new Date()
      autoSaveState.value.saveCount++
      retryCount = 0

      // 🔥 核心改进：清空累积的标记
      autoSaveState.value.configChanged = false
      autoSaveState.value.contentChanged = false
      autoSaveState.value.directoryChanged = false

      console.log('✅ [AutoSave] 自动保存成功')

      return true
    } catch (error) {
      console.error('❌ [AutoSave] 自动保存失败:', error)
      autoSaveState.value.errorCount++

      // 重试机制（保持标记不清空，下次重试时继续使用）
      if (retryCount < finalConfig.maxRetries) {
        retryCount++
        console.log(`🔄 [AutoSave] 准备重试 (${retryCount}/${finalConfig.maxRetries})`)

        // 延迟重试
        setTimeout(() => {
          performSave() // 递归重试，标记保持不变
        }, 5000 * retryCount) // 递增延迟
      } else {
        console.error('❌ [AutoSave] 达到最大重试次数，停止自动保存')
        retryCount = 0
        // 重试失败后也清空标记，避免一直积累
        autoSaveState.value.configChanged = false
        autoSaveState.value.contentChanged = false
        autoSaveState.value.directoryChanged = false
      }

      return false
    }
  }

  /**
   * 触发自动保存（防抖+节流）
   * 🔥 改进：使用标记累积机制，确保所有变化类型都被记录
   * @param options 保存选项，用于区分保存配置还是内容
   */
  function triggerAutoSave(options?: {
    configChanged?: boolean
    contentChanged?: boolean
    directoryChanged?: boolean
  }) {
    if (!autoSaveState.value.isEnabled) {
      return
    }

    // 🔥 核心改进：累积变化标记（使用 OR 逻辑）
    if (options?.configChanged) {
      autoSaveState.value.configChanged = true
    }
    if (options?.contentChanged) {
      autoSaveState.value.contentChanged = true
    }
    if (options?.directoryChanged) {
      autoSaveState.value.directoryChanged = true
    }

    console.log('📝 [AutoSave] 累积变化标记:', {
      configChanged: autoSaveState.value.configChanged,
      contentChanged: autoSaveState.value.contentChanged,
      directoryChanged: autoSaveState.value.directoryChanged,
    })

    // 触发防抖和节流（不传递参数）
    debouncedSave?.()
    throttledSave?.()
  }

  // ==================== 公共方法 ====================

  /**
   * 启用自动保存
   */
  function enableAutoSave() {
    autoSaveState.value.isEnabled = true
    initializeDebounceThrottle() // 重新初始化节流防抖函数
    setupWatchers() // 重新设置监听器
    console.log('✅ [AutoSave] 自动保存已启用')
  }

  /**
   * 禁用自动保存
   */
  function disableAutoSave() {
    autoSaveState.value.isEnabled = false
    clearTimers()
    clearWatchers() // 清除监听器
    console.log('⏸️ [AutoSave] 自动保存已禁用')
  }

  /**
   * 手动触发保存
   * 🔥 改进：手动保存前设置所有标记为true
   */
  async function manualSave(): Promise<boolean> {
    clearTimers() // 清除自动保存定时器
    // 手动保存时，标记所有类型的变化
    autoSaveState.value.configChanged = true
    autoSaveState.value.contentChanged = true
    autoSaveState.value.directoryChanged = true
    return await performSave()
  }

  /**
   * 重置自动保存状态
   * 🔥 改进：重置标记累积字段
   */
  function resetAutoSaveState() {
    autoSaveState.value = {
      isEnabled: finalConfig.enabled,
      lastSaveTime: null,
      saveCount: 0,
      errorCount: 0,
      // 🔥 重置标记
      configChanged: false,
      contentChanged: false,
      directoryChanged: false,
    }
    retryCount = 0
    clearTimers()
  }

  /**
   * 销毁模块，清理所有资源
   */
  function destroy() {
    clearTimers()
    clearWatchers()

    // 🌟 清理所有 mediaItem watchers
    cleanupAllMediaItemWatchers()

    console.log('🧹 [AutoSave] 模块已销毁')
  }

  // ==================== 数据监听设置 ====================

  /**
   * 设置数据监听器
   */
  function setupWatchers() {
    if (!finalConfig.enabled || !autoSaveState.value.isEnabled) {
      return
    }

    // 清除现有监听器
    clearWatchers()

    // 监听时间轴项目变化 - 内容变化
    // ✅ 使用精确字段监听，只监听需要持久化的字段
    const unwatchTimelineItems = watch(
      () => dataWatchers.timelineItems.value?.map(item => ({
        id: item.id,
        mediaItemId: item.mediaItemId,
        trackId: item.trackId,
        timelineStatus: item.timelineStatus,
        mediaType: item.mediaType,
        timeRange: item.timeRange,
        config: item.config,        // ✅ 监听
        animation: item.animation,  // ✅ 监听
        transitionOut: item.transitionOut, // ✅ 监听
        // ❌ 不监听 runtime（包括 runtime.renderConfig）
      })),
      () => {
        if (autoSaveState.value.isEnabled) {
          console.log('🔍 [AutoSave] timelineItems changed')
          triggerAutoSave({ contentChanged: true })
        }
      },
      { deep: true }
    )
    unwatchFunctions.push(unwatchTimelineItems)

    // 监听轨道变化 - 内容变化
    const unwatchTracks = watch(
      () => dataWatchers.tracks.value,
      () => {
        if (autoSaveState.value.isEnabled) {
          // console.log('🔄 [AutoSave] 检测到轨道变化')
          triggerAutoSave({ contentChanged: true })
        }
      },
      { deep: true },
    )
    unwatchFunctions.push(unwatchTracks)

    // ❌ 移除旧的 mediaItems 监听器（第481-502行）
    // 现在使用新的 MediaItem Watch 机制来监听单个 mediaItem 的 name 和 metadata 变化
    // const unwatchMediaItems = watch(
    //   () => dataWatchers.mediaItems.value?.map(item => ({
    //     id: item.id,
    //     name: item.name,
    //     createdAt: item.createdAt,
    //     mediaStatus: item.mediaStatus,
    //     mediaType: item.mediaType,
    //     source: item.source,
    //     duration: item.duration,
    //     // ❌ 不监听 runtime（包括 runtime.bunny.waveformLOD）
    //   })),
    //   () => {
    //     if (autoSaveState.value.isEnabled) {
    //       // console.log('🔄 [AutoSave] 检测到媒体项目变化')
    //       triggerAutoSave({ contentChanged: true })
    //     }
    //   },
    //   { deep: true },
    // )
    // unwatchFunctions.push(unwatchMediaItems)

    // 监听项目配置变化 - 配置变化
    const unwatchProjectConfig = watch(
      () => dataWatchers.projectConfig.value,
      () => {
        if (autoSaveState.value.isEnabled) {
          // console.log('🔄 [AutoSave] 检测到项目配置变化')
          triggerAutoSave({ configChanged: true })
        }
      },
      { deep: true },
    )
    unwatchFunctions.push(unwatchProjectConfig)

    // 🆕 监听目录配置变化 - 目录变化
    const unwatchDirectoryConfig = watch(
      () => dataWatchers.directoryConfig.value,
      () => {
        if (autoSaveState.value.isEnabled) {
          // console.log('🔄 [AutoSave] 检测到目录配置变化')
          triggerAutoSave({ directoryChanged: true })
        }
      },
      { deep: true },
    )
    unwatchFunctions.push(unwatchDirectoryConfig)
  }

  /**
   * 清除所有监听器
   */
  function clearWatchers() {
    unwatchFunctions.forEach((unwatch) => unwatch())
    unwatchFunctions.length = 0
  }

  // ==================== 初始化 ====================

  // 初始化节流防抖函数
  initializeDebounceThrottle()

  // 只有在启用状态下才设置监听器
  if (finalConfig.enabled && autoSaveState.value.isEnabled) {
    setupWatchers()
  }

  // ==================== 导出接口 ====================

  return {
    // 状态
    autoSaveState,

    // 配置
    config: finalConfig,

    // 方法
    enableAutoSave,
    disableAutoSave,
    manualSave,
    triggerAutoSave,
    resetAutoSaveState,
    destroy,

    // 🌟 新增：MediaItem Watch 管理方法
    setupMediaItemWatcher,
    cleanupMediaItemWatcher,
    cleanupAllMediaItemWatchers,
  }
}

// 导出类型定义
export type UnifiedAutoSaveModule = ReturnType<typeof createUnifiedAutoSaveModule>
