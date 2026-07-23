import { ref, computed, shallowRef, triggerRef } from 'vue'
import { generateDirectoryId, generateTabId } from '@/core/utils/idGenerator'
import type {
  VirtualDirectory,
  DisplayTab,
  DisplayItem,
  ClipboardState,
  ClipboardItem,
  PasteResult,
  ViewMode,
  SortBy,
  SortOrder,
  UnifiedDirectoryConfig,
  CharacterDirectory,
} from '@/core/directory/types'
import type { FileData } from '@/core/datasource/providers/ai-generation/types'
import { DirectoryType } from '@/core/directory/types'
import {
  AssetLocationIndex,
  persistAssetDirectoryMove,
} from '@/core/directory/AssetLocationIndex'
import { ModuleRegistry, MODULE_NAMES } from './ModuleRegistry'
import type { UnifiedMediaModule } from './UnifiedMediaModule'
import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'

/**
 * 统一目录模块（简化版）
 * 管理虚拟目录的创建、导航和标签页功能
 * 持久化由项目模块统一管理
 */
export function createUnifiedDirectoryModule(registry: ModuleRegistry) {
  // 通过注册中心获取依赖模块
  const mediaModule = registry.get<UnifiedMediaModule>(MODULE_NAMES.MEDIA)
  let ensureMediaReadyForLazyLoad: ((mediaId: string) => Promise<unknown>) | null = null

  // ==================== 状态定义 ====================

  // 目录列表
  const directories = ref<Map<string, VirtualDirectory>>(new Map())

  // 目录内容的运行时索引。持久化归属只保存在媒体 Meta 的 parentDirectoryId 中。
  const assetLocationIndex = shallowRef(new AssetLocationIndex())

  function notifyAssetLocationChanged(): void {
    triggerRef(assetLocationIndex)
  }

  // 打开的标签页列表
  const openTabs = ref<DisplayTab[]>([])

  // 当前活动标签页ID
  const activeTabId = ref<string>('')

  // 剪贴板状态
  const clipboardState = ref<ClipboardState>({
    items: [],
    sourceDirId: null,
    timestamp: 0,
  })

  // 视图模式状态
  const viewMode = ref<ViewMode>('medium-icon')

  // 排序状态
  const sortBy = ref<SortBy>('date')
  const sortOrder = ref<SortOrder>('desc')

  // ==================== 计算属性 ====================

  // 当前活动的标签页
  const activeTab = computed(() => {
    return openTabs.value.find((tab) => tab.id === activeTabId.value) || null
  })

  // 当前显示的目录
  const currentDir = computed(() => {
    if (!activeTab.value) return null
    return directories.value.get(activeTab.value.dirId) || null
  })

  type DirectoryMutationErrorCode = 'invalid_name' | 'duplicate_name' | 'not_found'
  type DirectoryMutationResult =
    | { success: true; directory: VirtualDirectory }
    | { success: false; error: string; code: DirectoryMutationErrorCode }

  function normalizeDirectoryName(name: string): string {
    return name.trim()
  }

  function getSiblingDirectories(parentId: string | null): VirtualDirectory[] {
    return Array.from(directories.value.values()).filter((dir) => dir.parentId === parentId)
  }

  function validateDirectoryName(
    name: string,
    parentId: string | null,
    excludeDirId?: string,
  ): { ok: true; normalizedName: string } | { ok: false; error: string; code: DirectoryMutationErrorCode } {
    const normalizedName = normalizeDirectoryName(name)

    if (!normalizedName) {
      return { ok: false, error: '目录名称不能为空', code: 'invalid_name' }
    }

    if (normalizedName === '.' || normalizedName === '..') {
      return { ok: false, error: '目录名称不能为 . 或 ..', code: 'invalid_name' }
    }

    if (/[\/\\]/.test(normalizedName)) {
      return { ok: false, error: '目录名称不能包含 / 或 \\', code: 'invalid_name' }
    }

    if (/[\u0000-\u001f\u007f]/.test(normalizedName)) {
      return { ok: false, error: '目录名称不能包含控制字符', code: 'invalid_name' }
    }

    const duplicate = getSiblingDirectories(parentId).find(
      (dir) => dir.id !== excludeDirId && dir.name === normalizedName,
    )
    if (duplicate) {
      return { ok: false, error: `当前目录下已存在同名文件夹“${normalizedName}”`, code: 'duplicate_name' }
    }

    return { ok: true, normalizedName }
  }

  function createDirectoryRecord(name: string, parentId: string | null = null): VirtualDirectory {
    const newDir: VirtualDirectory = {
      type: DirectoryType.BASE,
      id: generateDirectoryId(),
      name,
      parentId,
      createdAt: new Date().toISOString(),
      childDirIds: [],
    }

    directories.value.set(newDir.id, newDir)

    if (parentId) {
      const parentDir = directories.value.get(parentId)
      if (parentDir) {
        parentDir.childDirIds.push(newDir.id)
      }
    }

    return newDir
  }

  // ==================== 核心方法 ====================

  /**
   * 注入媒体 ready 资源确保器。
   *
   * 目录模块只负责“用户看到了某个目录，需要启动这个目录里的懒加载媒体”；
   * 具体媒体文件准备、解码、保存和状态汇聚由 JobRuntime 的 media-ready DAG 负责。
   */
  function setMediaReadyEnsurer(ensurer: (mediaId: string) => Promise<unknown>): void {
    ensureMediaReadyForLazyLoad = ensurer
  }

  /**
   * 创建新目录
   */
  function createDirectory(name: string, parentId: string | null = null): DirectoryMutationResult {
    if (parentId && !directories.value.has(parentId)) {
      return { success: false, error: '父目录不存在', code: 'not_found' }
    }

    const validation = validateDirectoryName(name, parentId)
    if (!validation.ok) {
      return { success: false, error: validation.error, code: validation.code }
    }

    return {
      success: true,
      directory: createDirectoryRecord(validation.normalizedName, parentId),
    }
  }

  /**
   * 创建角色文件夹
   */
  function createCharacterDirectory(
    name: string,
    remark: string,
    refVideo: FileData[] = [],
    parentId: string | null = null,
    timestamps: { st: number; ed: number },
  ): CharacterDirectory {
    const validation = validateDirectoryName(name, parentId)
    if (!validation.ok) {
      throw new Error(validation.error)
    }

    const characterDir: CharacterDirectory = {
      type: DirectoryType.CHARACTER,
      id: generateDirectoryId(),
      name: validation.normalizedName,
      parentId,
      createdAt: new Date().toISOString(),
      childDirIds: [],
      character: {
        remark,
        refVideo,
        timestamps,
      },
    }

    directories.value.set(characterDir.id, characterDir)

    // 如果有父目录，更新父目录的子目录列表
    if (parentId) {
      const parentDir = directories.value.get(parentId)
      if (parentDir) {
        parentDir.childDirIds.push(characterDir.id)
      }
    }

    console.log('✅ 角色文件夹创建成功:', characterDir.name)
    return characterDir
  }

  /**
   * 类型守卫：判断是否为角色文件夹
   */
  function isCharacterDirectory(dir: VirtualDirectory): dir is CharacterDirectory {
    return dir.type === DirectoryType.CHARACTER
  }

  /**
   * 获取角色文件夹
   */
  function getCharacterDirectory(dirId: string): CharacterDirectory | undefined {
    const dir = directories.value.get(dirId)
    if (dir && isCharacterDirectory(dir)) {
      return dir
    }
    return undefined
  }

  /**
   * 重命名目录
   */
  function renameDirectory(id: string, newName: string): DirectoryMutationResult {
    const dir = directories.value.get(id)
    if (!dir) {
      return { success: false, error: '目录不存在', code: 'not_found' }
    }

    if (dir.parentId === null) {
      return { success: false, error: '不能重命名根目录', code: 'invalid_name' }
    }

    const validation = validateDirectoryName(newName, dir.parentId, id)
    if (!validation.ok) {
      return { success: false, error: validation.error, code: validation.code }
    }

    dir.name = validation.normalizedName
    return { success: true, directory: dir }
  }

  /**
   * 获取目录
   */
  function getDirectory(id: string): VirtualDirectory | undefined {
    return directories.value.get(id)
  }

  /**
   * 为刚创建或刚恢复的媒体登记目录归属。
   * 媒体对象必须已经带有有效的 parentDirectoryId，不能在这里自动补齐。
   */
  function registerAssetLocation(assetId: string): { success: boolean; error?: string } {
    const asset = mediaModule.getMediaAsset(assetId)
    if (!asset) {
      return { success: false, error: '素材不存在' }
    }
    if (!directories.value.has(asset.parentDirectoryId)) {
      return { success: false, error: '素材所属文件夹不存在' }
    }

    try {
      assetLocationIndex.value.register(asset.id, asset.parentDirectoryId)
      notifyAssetLocationChanged()
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '登记素材目录归属失败',
      }
    }
  }

  /**
   * 返回素材持久化的所属目录。目录不存在时视为无效归属。
   */
  function getAssetDirectoryId(assetId: string): string | null {
    const asset = mediaModule.getMediaAsset(assetId)
    if (!asset || !directories.value.has(asset.parentDirectoryId)) {
      return null
    }
    return asset.parentDirectoryId
  }

  function getAssetIdsInDirectory(dirId: string): string[] {
    return assetLocationIndex.value.getAssetIds(dirId)
  }

  /**
   * 移动素材。先持久化 Meta，保存失败时恢复内存中的原目录并保持索引不变。
   */
  async function moveAssetToDirectory(
    assetId: string,
    targetDirectoryId: string,
  ): Promise<{ success: boolean; error?: string }> {
    const asset = mediaModule.getMediaAsset(assetId)
    if (!asset) {
      return { success: false, error: '素材不存在' }
    }
    if (!directories.value.has(targetDirectoryId)) {
      return { success: false, error: '目标文件夹不存在' }
    }

    const sourceDirectoryId = getAssetDirectoryId(assetId)
    if (!sourceDirectoryId) {
      return { success: false, error: '素材所属文件夹不存在' }
    }
    if (assetLocationIndex.value.getDirectoryId(assetId) !== sourceDirectoryId) {
      return { success: false, error: '素材目录索引未初始化' }
    }
    if (sourceDirectoryId === targetDirectoryId) {
      return { success: true }
    }

    const persisted = await persistAssetDirectoryMove(
      asset,
      targetDirectoryId,
      (mediaItem) => globalMetaFileManager.saveMetaFile(mediaItem),
    )
    if (!persisted) {
      return { success: false, error: '保存素材所属文件夹失败，已恢复原位置' }
    }

    try {
      assetLocationIndex.value.move(assetId, targetDirectoryId)
      notifyAssetLocationChanged()
      return { success: true }
    } catch (error) {
      // 索引异常不应让已成功持久化的数据保持错误的内存状态。
      asset.parentDirectoryId = sourceDirectoryId
      await globalMetaFileManager.saveMetaFile(asset)
      return {
        success: false,
        error: error instanceof Error ? error.message : '更新素材目录索引失败，已恢复原位置',
      }
    }
  }

  /**
   * 获取目录内容（返回 DisplayItem[]）
   */
  function getDirectoryContent(dirId: string): DisplayItem[] {
    const dir = directories.value.get(dirId)
    if (!dir) return []

    const items: DisplayItem[] = []

    // 添加子目录
    dir.childDirIds.forEach((childDirId) => {
      items.push({
        id: childDirId,
        type: 'directory',
      })
    })

    // 添加媒体项
    assetLocationIndex.value.getAssetIds(dirId).forEach((mediaId) => {
      items.push({
        id: mediaId,
        type: 'asset',
      })
    })

    return items
  }

  /**
   * 通过 parentId 链计算面包屑路径
   */
  function getBreadcrumb(dirId: string): VirtualDirectory[] {
    const breadcrumb: VirtualDirectory[] = []
    let currentId: string | null = dirId

    while (currentId) {
      const dir = directories.value.get(currentId)
      if (!dir) break

      breadcrumb.unshift(dir)
      currentId = dir.parentId
    }

    return breadcrumb
  }

  /**
   * 打开新标签页
   * @param dirId 目录ID
   * @param switchToNewTab 是否切换到新标签页，默认为 true
   */
  function openTab(dirId: string, switchToNewTab: boolean = false): DisplayTab {
    const newTab: DisplayTab = {
      id: generateTabId(),
      dirId,
    }

    openTabs.value.push(newTab)

    // 如果这是第一个标签页，或者明确要求切换，设置为活动标签页
    if (openTabs.value.length === 1 || switchToNewTab) {
      activeTabId.value = newTab.id
    }

    return newTab
  }

  /**
   * 关闭标签页
   */
  function closeTab(tabId: string): boolean {
    const tabIndex = openTabs.value.findIndex((tab) => tab.id === tabId)
    if (tabIndex === -1) return false

    // 如果只有一个标签页，不允许关闭
    if (openTabs.value.length === 1) {
      return false
    }

    // 如果关闭的是当前活动标签页，需要切换到其他标签页
    if (activeTabId.value === tabId) {
      // 优先切换到下一个标签页，如果没有则切换到上一个
      const nextTab = openTabs.value[tabIndex + 1] || openTabs.value[tabIndex - 1]
      if (nextTab) {
        activeTabId.value = nextTab.id
      }
    }

    openTabs.value.splice(tabIndex, 1)
    return true
  }

  /**
   * 启动目录中 pending 状态的资产
   * 包括当前目录的资产项和角色类型子文件夹中的资产项
   */
  function startPendingAssetsInDirectory(dirId: string): void {
    const dir = directories.value.get(dirId)
    if (!dir || !mediaModule) return

    let startedCount = 0

    const startAssetIfNeeded = (assetId: string) => {
      const mediaItem = mediaModule.getMediaItem(assetId)
      if (mediaItem?.assetKind === 'media' && mediaItem.mediaStatus === 'pending') {
        if (ensureMediaReadyForLazyLoad) {
          void ensureMediaReadyForLazyLoad(mediaItem.id).catch((error) => {
            console.error(
              `❌ [DirectoryModule] 懒加载媒体失败，已跳过: ${mediaItem.name}`,
              error,
            )
          })
        } else {
          console.warn(
            `⚠️ [DirectoryModule] ensureMediaReady 未初始化，跳过懒加载媒体: ${mediaItem.name}`,
          )
        }
        startedCount++
        return
      }

    }

    // 处理当前目录的资产项
    getAssetIdsInDirectory(dirId).forEach(startAssetIfNeeded)

    // 处理角色类型子文件夹中的资产项
    dir.childDirIds.forEach((childDirId) => {
      const childDir = directories.value.get(childDirId)
      if (childDir && isCharacterDirectory(childDir)) {
        getAssetIdsInDirectory(childDirId).forEach(startAssetIfNeeded)
      }
    })

    if (startedCount > 0) {
      console.log(`🚀 [DirectoryModule] 启动了 ${startedCount} 个延迟加载的资产`)
    }
  }

  /**
   * 在当前标签页导航到指定目录（修改 activeTab.dirId）
   */
  function navigateToDir(dirId: string): boolean {
    if (!activeTab.value) return false

    const targetDir = directories.value.get(dirId)
    if (!targetDir) return false

    activeTab.value.dirId = dirId

    // 启动该目录中 pending 状态的资产
    startPendingAssetsInDirectory(dirId)

    return true
  }

  /**
   * 切换到指定标签页
   */
  function switchTab(tabId: string): boolean {
    const tab = openTabs.value.find((t) => t.id === tabId)
    if (!tab) return false

    activeTabId.value = tabId

    // 启动目标目录中 pending 状态的资产
    startPendingAssetsInDirectory(tab.dirId)

    return true
  }

  /**
   * 初始化根目录
   */
  function initializeRootDirectory(): VirtualDirectory {
    // 检查是否已存在根目录
    const existingRoot = Array.from(directories.value.values()).find((dir) => dir.parentId === null)
    if (existingRoot) {
      return existingRoot
    }

    // 创建根目录
    const rootDir = createDirectoryRecord('root', null)

    // 打开根目录标签页
    openTab(rootDir.id)

    return rootDir
  }

  /**
   * 获取所有目录（用于调试和管理）
   */
  function getAllDirectories(): VirtualDirectory[] {
    return Array.from(directories.value.values())
  }

  /**
   * 重置目录状态
   */
  function resetDirectories(): void {
    directories.value.clear()
    assetLocationIndex.value.clear()
    notifyAssetLocationChanged()
    openTabs.value.length = 0
    activeTabId.value = ''
  }

  /**
   * 获取目录统计信息
   */
  function getDirectorySummary() {
    return {
      totalDirectories: directories.value.size,
      openTabsCount: openTabs.value.length,
      activeTabId: activeTabId.value,
      currentDirId: currentDir.value?.id || null,
      currentDirName: currentDir.value?.name || null,
    }
  }

  // ==================== 剪贴板方法 ====================

  /**
   * 检查目录A是否是目录B的子孙目录
   */
  function isDescendantOf(dirA: string, dirB: string): boolean {
    let current = getDirectory(dirA)
    while (current) {
      if (current.parentId === dirB) return true
      if (!current.parentId) break
      current = getDirectory(current.parentId)
    }
    return false
  }

  // ==================== 拖拽专用方法 ====================

  /**
   * 检查是否可以将文件夹拖拽到目标文件夹
   * @param sourceFolderId 源文件夹ID
   * @param targetFolderId 目标文件夹ID
   * @returns 是否可以拖拽
   */
  function canDragToFolder(sourceFolderId: string, targetFolderId: string): boolean {
    // 不能拖拽到自己
    if (sourceFolderId === targetFolderId) {
      return false
    }

    // 不能拖拽到子文件夹（防止循环引用）
    if (isDescendantOf(targetFolderId, sourceFolderId)) {
      return false
    }

    return true
  }

  /**
   * 拖拽移动媒体项到目标文件夹
   * @param assetIds 资产ID列表
   * @param sourceFolderId 源文件夹ID（可能为null）
   * @param targetFolderId 目标文件夹ID
   */
  async function dragMoveMediaItems(
    assetIds: string[],
    _sourceFolderId: string | null,
    targetFolderId: string,
  ): Promise<void> {
    for (const assetId of assetIds) {
      const result = await moveAssetToDirectory(assetId, targetFolderId)
      if (!result.success) {
        throw new Error(result.error)
      }
    }

    console.log(`✅ 拖拽移动 ${assetIds.length} 个资产到文件夹 ${targetFolderId}`)
  }

  /**
   * 拖拽移动文件夹到目标文件夹
   * @param folderId 要移动的文件夹ID
   * @param targetFolderId 目标父文件夹ID
   */
  async function dragMoveFolder(folderId: string, targetFolderId: string): Promise<void> {
    // 验证是否可以移动
    if (!canDragToFolder(folderId, targetFolderId)) {
      throw new Error('不能将文件夹拖拽到此位置')
    }

    const folder = getDirectory(folderId)
    if (!folder) {
      throw new Error('源文件夹不存在')
    }

    // 从原父文件夹移除
    if (folder.parentId) {
      const parentDir = getDirectory(folder.parentId)
      if (parentDir) {
        const index = parentDir.childDirIds.indexOf(folderId)
        if (index > -1) {
          parentDir.childDirIds.splice(index, 1)
        }
      }
    }

    // 更新父文件夹
    folder.parentId = targetFolderId

    // 添加到目标文件夹
    const targetDir = getDirectory(targetFolderId)
    if (targetDir) {
      targetDir.childDirIds.push(folderId)
    }

    console.log(`✅ 拖拽移动文件夹 ${folderId} 到 ${targetFolderId}`)
  }

  /**
   * 剪切项目。素材库仅支持剪切粘贴移动，不支持复制。
   */
  function cut(items: DisplayItem[]): void {
    if (items.length === 0) return

    // 构建剪贴板项目
    const clipboardItems: ClipboardItem[] = items.map((item) => ({
      id: item.id,
      type: item.type,
    }))

    // 更新剪贴板状态
    clipboardState.value = {
      items: clipboardItems,
      sourceDirId: currentDir.value?.id || null,
      timestamp: Date.now(),
    }

    console.log(`✂️ 剪切 ${items.length} 个项目`)
  }

  /**
   * 检查是否可以粘贴到目标目录
   * ❌ 不能粘贴到来源目录
   * ❌ 不能粘贴目录到自己
   * ❌ 不能粘贴目录到子目录（防止循环引用）
   * ✅ 可以粘贴到其他任何目录
   */
  function canPaste(targetDirId: string): boolean {
    // 剪贴板为空
    if (clipboardState.value.items.length === 0) return false

    // 不能粘贴到来源目录
    if (clipboardState.value.sourceDirId === targetDirId) {
      return false
    }

    // 检查是否粘贴到自己或子目录（防止循环）
    for (const item of clipboardState.value.items) {
      if (item.type === 'directory') {
        if (item.id === targetDirId) {
          return false // 不能粘贴到自己
        }
        if (isDescendantOf(targetDirId, item.id)) {
          return false // 不能粘贴到子目录
        }
      }
    }

    return true
  }

  /**
   * 移动项目（剪切操作）
   */
  async function moveItem(item: ClipboardItem, targetDirId: string): Promise<void> {
    if (item.type === 'directory') {
      // 移动目录
      const dir = getDirectory(item.id)
      if (!dir) throw new Error('目录不存在')

      // 从原父目录移除
      if (dir.parentId) {
        const parentDir = getDirectory(dir.parentId)
        if (parentDir) {
          const index = parentDir.childDirIds.indexOf(item.id)
          if (index > -1) {
            parentDir.childDirIds.splice(index, 1)
          }
        }
      }

      // 更新目录的父目录
      dir.parentId = targetDirId

      // 添加到目标目录
      const targetDir = getDirectory(targetDirId)
      if (targetDir) {
        targetDir.childDirIds.push(item.id)
      }
    } else {
      const result = await moveAssetToDirectory(item.id, targetDirId)
      if (!result.success) {
        throw new Error(result.error)
      }
    }
  }

  /**
   * 粘贴到目标目录
   */
  async function paste(targetDirId: string): Promise<PasteResult> {
    if (!canPaste(targetDirId)) {
      return {
        success: false,
        successCount: 0,
        failedCount: 0,
        errors: [
          {
            itemId: '',
            error: '无法粘贴到此位置',
          },
        ],
      }
    }

    const result: PasteResult = {
      success: true,
      successCount: 0,
      failedCount: 0,
      errors: [],
    }

    // 获取目标目录
    const targetDir = getDirectory(targetDirId)
    if (!targetDir) {
      result.success = false
      result.errors.push({
        itemId: targetDirId,
        error: '目标目录不存在',
      })
      return result
    }

    // 处理每个剪贴板项目
    for (const clipItem of clipboardState.value.items) {
      try {
        await moveItem(clipItem, targetDirId)

        result.successCount++
      } catch (error) {
        result.failedCount++
        result.errors.push({
          itemId: clipItem.id,
          error: error instanceof Error ? error.message : '未知错误',
        })
      }
    }

    // 移动完成后清空剪贴板
    clearClipboard()

    result.success = result.failedCount === 0

    console.log(`📌 粘贴完成: 成功 ${result.successCount}, 失败 ${result.failedCount}`)
    return result
  }

  /**
   * 清空剪贴板
   */
  function clearClipboard(): void {
    clipboardState.value = {
      items: [],
      sourceDirId: null,
      timestamp: 0,
    }
  }

  /**
   * 设置视图模式
   */
  function setViewMode(mode: ViewMode): void {
    viewMode.value = mode
  }

  /**
   * 设置排序方式
   */
  function setSortBy(newSortBy: SortBy): void {
    if (sortBy.value === newSortBy) {
      // 如果点击相同的排序方式，切换升序/降序
      sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
    } else {
      // 如果是新的排序方式，默认升序
      sortBy.value = newSortBy
      sortOrder.value = 'asc'
    }
  }

  /**
   * 设置排序顺序
   */
  function setSortOrder(order: SortOrder): void {
    sortOrder.value = order
  }

  /**
   * 从项目设置恢复目录状态
   * @param directoryConfig 目录配置数据，如果为 null 则初始化默认目录
   */
  function restoreFromProjectSettings(directoryConfig: UnifiedDirectoryConfig | null): void {
    try {
      // 如果配置为 null，初始化默认目录
      if (!directoryConfig) {
        console.log(`📄 目录配置不存在，初始化默认目录`)
        resetDirectories()
        initializeRootDirectory()
        return
      }

      console.log(`📂 从配置恢复目录状态`)

      // 清空现有状态
      resetDirectories()

      // 恢复目录列表
      const dirMap = new Map<string, VirtualDirectory>()
      directoryConfig.directories.forEach((dir) => {
        dirMap.set(dir.id, dir)
      })
      directories.value = dirMap

      // 恢复标签页状态
      openTabs.value = directoryConfig.openTabs || []
      activeTabId.value = directoryConfig.activeTabId || ''

      // 恢复视图和排序设置
      if (directoryConfig.viewMode) {
        viewMode.value = directoryConfig.viewMode
      }
      if (directoryConfig.sortBy) {
        sortBy.value = directoryConfig.sortBy
      }
      if (directoryConfig.sortOrder) {
        sortOrder.value = directoryConfig.sortOrder
      }

      console.log(
        `✅ 目录状态恢复成功: ${directories.value.size} 个目录, ${openTabs.value.length} 个标签页`,
      )
    } catch (error) {
      console.error(`❌ 恢复目录状态失败`, error)
      // 恢复失败时初始化默认状态
      resetDirectories()
      initializeRootDirectory()
    }
  }

  /**
   * 删除文件夹及其子树中的媒体。
   * 先完整删除媒体（包含关联时间线片段），全部成功后才改变目录树。
   */
  async function deleteDirectory(dirId: string): Promise<{
    success: boolean
    deletedMediaIds: string[]
    error?: string
  }> {
    const dir = directories.value.get(dirId)
    if (!dir) {
      return { success: false, deletedMediaIds: [], error: '文件夹不存在' }
    }

    // 不允许删除根目录
    if (dir.parentId === null) {
      return { success: false, deletedMediaIds: [], error: '不能删除根目录' }
    }

    const deletedMediaIds: string[] = []

    try {
      // 步骤1: 收集所有需要删除的子文件夹。
      const dirsToDelete: string[] = [dirId]
      const allMediaIds = new Set<string>()

      let index = 0
      while (index < dirsToDelete.length) {
        const currentDirId = dirsToDelete[index]
        const currentDir = directories.value.get(currentDirId)

        if (currentDir) {
          // 收集子文件夹
          dirsToDelete.push(...currentDir.childDirIds)

          getAssetIdsInDirectory(currentDirId).forEach((mediaId) => allMediaIds.add(mediaId))
        }

        index++
      }

      console.log(`📊 [deleteDirectory] 收集完成:`, {
        totalDirs: dirsToDelete.length,
        totalMedia: allMediaIds.size,
        dirs: dirsToDelete,
        media: Array.from(allMediaIds),
      })

      // 步骤2: 先删除所有素材及其关联时间线片段。任一失败时保留目录树，
      // 未删除的素材和目录可供用户重试。
      for (const mediaId of allMediaIds) {
        const mediaDirectoryId = getAssetDirectoryId(mediaId)
        if (!mediaDirectoryId || !dirsToDelete.includes(mediaDirectoryId)) {
          throw new Error(`素材 ${mediaId} 的所属文件夹无效`)
        }

        const result = await deleteAssetItem(mediaId, mediaDirectoryId)
        if (!result.success) {
          throw new Error(result.error || `删除素材 ${mediaId} 失败`)
        }
        deletedMediaIds.push(mediaId)
      }

      // 步骤3: 所有素材成功删除后，再从父文件夹中移除根文件夹。
      if (dir.parentId) {
        const parentDir = directories.value.get(dir.parentId)
        if (parentDir) {
          const index = parentDir.childDirIds.indexOf(dirId)
          if (index > -1) {
            parentDir.childDirIds.splice(index, 1)
          }
        }
      }

      // 步骤4: 关闭显示被删除文件夹的标签页。
      const tabsToClose: string[] = []
      for (const tab of openTabs.value) {
        if (dirsToDelete.includes(tab.dirId)) {
          tabsToClose.push(tab.id)
        }
      }

      // 关闭所有相关标签页
      for (const tabId of tabsToClose) {
        if (openTabs.value.length === 1) {
          const remainingTab = openTabs.value.find((tab) => tab.id === tabId)
          if (remainingTab && dir.parentId) {
            remainingTab.dirId = dir.parentId
            activeTabId.value = remainingTab.id
          }
        } else {
          closeTab(tabId)
        }
      }

      console.log(`🗂️ [deleteDirectory] 关闭了 ${tabsToClose.length} 个标签页`)

      // 步骤5: 删除所有收集到的文件夹（从子到父的顺序）。
      for (let i = dirsToDelete.length - 1; i >= 0; i--) {
        directories.value.delete(dirsToDelete[i])
      }

      console.log(`✅ [deleteDirectory] 文件夹删除成功: ${dir.name}`, {
        deletedDirCount: dirsToDelete.length,
        deletedMediaCount: deletedMediaIds.length,
        deletedMediaIds,
      })

      return { success: true, deletedMediaIds }
    } catch (error) {
      console.error(`❌ [deleteDirectory] 删除文件夹失败: ${dir.name}`, error)
      return {
        success: false,
        deletedMediaIds,
        error: error instanceof Error ? error.message : '未知错误',
      }
    }
  }

  /**
   * 删除媒体项及其关联时间线片段。
   * 单归属模型下，素材只要从所属目录删除，就必须从项目中删除。
   */
  async function deleteAssetItem(
    mediaId: string,
    dirId: string,
  ): Promise<{
    success: boolean
    deletedFile: boolean
    error?: string
  }> {
    if (!directories.value.has(dirId)) {
      return { success: false, deletedFile: false, error: '目录不存在' }
    }

    const mediaItem = mediaModule.getMediaAsset(mediaId)

    try {
      if (!mediaItem) {
        return { success: false, deletedFile: false, error: '素材不存在' }
      }

      if (
        mediaItem.parentDirectoryId !== dirId ||
        assetLocationIndex.value.getDirectoryId(mediaId) !== dirId
      ) {
        return { success: false, deletedFile: false, error: '资产不在该目录中' }
      }

      // removeAsset 会删除关联时间线片段、媒体文件和 Meta 文件。
      try {
        await mediaModule.removeAsset(mediaId)
      } catch (error) {
        return {
          success: false,
          deletedFile: false,
          error: error instanceof Error ? error.message : '删除素材文件失败',
        }
      }

      assetLocationIndex.value.remove(mediaId)
      notifyAssetLocationChanged()

      console.log(`✅ [deleteAssetItem] 资产删除成功: ${mediaItem.name}`)

      return { success: true, deletedFile: true }
    } catch (error) {
      console.error(`❌ [deleteAssetItem] 删除资产失败: ${mediaItem?.name || mediaId}`, error)
      return {
        success: false,
        deletedFile: false,
        error: error instanceof Error ? error.message : '未知错误',
      }
    }
  }

  async function deleteMediaItem(mediaId: string, dirId: string) {
    return deleteAssetItem(mediaId, dirId)
  }

  // ==================== 返回接口 ====================

  return {
    // 状态
    directories,
    openTabs,
    activeTabId,

    // 计算属性
    activeTab,
    currentDir,

    // 核心方法
    createDirectory,
    createCharacterDirectory, // 🆕 新增创建角色文件夹方法
    renameDirectory,
    getDirectory,
    getCharacterDirectory, // 🆕 新增获取角色文件夹方法
    isCharacterDirectory, // 🆕 新增类型守卫方法
    setMediaReadyEnsurer,
    registerAssetLocation,
    moveAssetToDirectory,
    getAssetDirectoryId,
    getAssetIdsInDirectory,
    getDirectoryContent,
    getBreadcrumb,
    openTab,
    closeTab,
    navigateToDir,
    switchTab,
    deleteDirectory, // 🆕 新增删除文件夹方法
    deleteAssetItem,
    deleteMediaItem, // 🆕 新增删除媒体项方法

    // 初始化和管理方法
    initializeRootDirectory,
    getAllDirectories,
    resetDirectories,
    getDirectorySummary,
    restoreFromProjectSettings,

    // 剪贴板操作
    clipboardState,
    cut,
    paste,
    canPaste,
    clearClipboard,

    // 拖拽专用方法
    canDragToFolder,
    dragMoveMediaItems,
    dragMoveFolder,
    isDescendantOf,

    // 视图和排序状态
    viewMode,
    sortBy,
    sortOrder,
    setViewMode,
    setSortBy,
    setSortOrder,
  }
}

/**
 * 重新导出所有类型
 */
export type {
  VirtualDirectory,
  DisplayTab,
  DisplayItem,
  DirectoryNavigationState,
  ClipboardState,
  ClipboardItem,
  PasteResult,
  PasteError,
  ViewMode,
  SortBy,
  SortOrder,
  UnifiedDirectoryConfig,
  DirectoryType,
} from '@/core/directory/types'

/**
 * 导出模块类型
 */
export type UnifiedDirectoryModule = ReturnType<typeof createUnifiedDirectoryModule>
