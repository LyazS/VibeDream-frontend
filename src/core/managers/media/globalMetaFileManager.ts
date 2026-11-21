import { toRaw } from 'vue'
import {
  pruneLinkedHandles,
  withLinkedProjectLock,
  type LinkedProjectScope,
} from '@/core/datasource/providers/linked-file/LinkedMediaBindings'
import {
  createLinkedMediaReader,
  verifyLinkedContent,
} from '@/core/datasource/providers/linked-file/LinkedMediaReader'
import type { LinkedFileSourceData } from '@/core/datasource/providers/linked-file/LinkedFileSource'
import { fileSystemService } from '@/core/managers/filesystem/fileSystemService'
import {
  MEDIA_META_VERSION,
  parseLibraryAssetMetaFile,
  readDamagedLinkedMediaMeta,
  type MediaMetaFile,
  type MediaLibraryAssetMetaFile,
} from '@/core/project/metaTypes'
import type { UnifiedMediaItemData, MediaStatus } from '@/core/mediaitem/types'
import {
  getMediaFileName,
  getMediaPath,
  type MediaFileReference,
} from '@/core/utils/mediaPathUtils'
import { extractSourceData } from '@/core/datasource/core/DataSourceTypes'
import type { UnifiedLibraryAssetData } from '@/core/asset/types'
import { extractEffectTemplateSourceData, isMediaAsset } from '@/core/asset/types'

/**
 * 媒体保存结果接口
 */
export interface MediaSaveResult {
  success: boolean
  mediaId?: string
  storagePath?: string
  isReused?: boolean
  error?: string
}

/** 固定一次导入的工程；异步步骤之后及写入之前重新检查执行权限。 */
export interface MediaPersistenceContext {
  projectId: string
  workspaceKey?: string | null
  assertActive?: () => void
}

interface MediaReadOptions {
  context?: MediaPersistenceContext
  linkedReader?: ReturnType<typeof createLinkedMediaReader>
  verifyContent?: boolean
  signal?: AbortSignal
}

type LinkedMetaCommit = { source: LinkedFileSourceData } & (
  | { initial: true }
  | { onCommitted: () => void }
)

/**
 * 全局Meta文件管理器
 * 统一管理媒体文件 + Meta文件的完整生命周期
 *
 * 核心职责：
 * 1. 媒体文件管理：保存、加载、验证
 * 2. Meta文件管理：保存、读取、扫描
 * 3. 项目初始化：扫描媒体文件
 */
class GlobalMetaFileManager {
  private projectId: string = ''
  private session = {}
  private readonly assetContexts = new WeakMap<UnifiedLibraryAssetData, MediaPersistenceContext>()
  private readonly deletingAssets = new WeakSet<UnifiedLibraryAssetData>()

  /**
   * 初始化管理器
   * @param projectId 项目ID
   */
  async initialize(projectId: string): Promise<void> {
    this.projectId = projectId
    this.session = {}
    console.log(`🔧 [globalMetaFileManager] 初始化: ${projectId}`)
  }

  /**
   * 获取当前项目ID
   */
  get currentProjectId(): string {
    return this.projectId
  }

  captureContext(): MediaPersistenceContext {
    const { projectId, session } = this
    const workspaceKey = fileSystemService.workspaceKey
    return {
      projectId,
      workspaceKey,
      assertActive: () => {
        if (
          !projectId ||
          this.session !== session ||
          fileSystemService.workspaceKey !== workspaceKey
        ) {
          throw new Error('素材所属工程或工作区已切换')
        }
      },
    }
  }

  bindAsset(asset: UnifiedLibraryAssetData): void {
    this.assetContexts.set(toRaw(asset), this.captureContext())
  }

  contextForAsset(asset: UnifiedLibraryAssetData): MediaPersistenceContext {
    return this.assetContexts.get(toRaw(asset)) ?? this.captureContext()
  }

  assertAssetActive(asset: UnifiedLibraryAssetData): void {
    this.contextForAsset(asset).assertActive?.()
    if (this.deletingAssets.has(toRaw(asset))) throw new Error('素材已删除或正在删除')
  }

  // ==================== 媒体文件操作 ====================

  /**
   * 保存媒体文件到项目
   * @param file 媒体文件
   * @param media 媒体 ID 和原文件扩展名
   * @returns 是否成功
   */
  async saveMediaFile(
    file: File,
    media: MediaFileReference,
    context: MediaPersistenceContext = this.captureContext(),
  ): Promise<boolean> {
    const { id } = media
    const workspaceKey = context.workspaceKey ?? fileSystemService.workspaceKey
    try {
      context.assertActive?.()
      console.info('[MediaIdentity] save-file:start', {
        projectId: context.projectId,
        id,
        ext: media.ext,
        originalFileName: file.name,
        fileType: file.type,
        fileSize: file.size,
      })

      // 检查工作空间权限
      const permissionResult = await fileSystemService.checkPermission()
      context.assertActive?.()
      if (!permissionResult.hasAccess) throw new Error('未设置工作目录')

      // 确保 media 目录存在
      const mediaDirPath = fileSystemService.paths.getMediaDirPath(context.projectId)
      const mediaDirExists = await fileSystemService.directoryExists(mediaDirPath)
      context.assertActive?.()
      if (!mediaDirExists) {
        await fileSystemService.createDirectory(mediaDirPath, {
          workspaceKey,
          assertActive: context.assertActive,
        })
        context.assertActive?.()
      }

      // 保存文件
      const mediaPath = fileSystemService.paths.getMediaPath(context.projectId, media)
      await fileSystemService.writeFile(mediaPath, file, {
        workspaceKey,
        assertActive: context.assertActive,
      })
      context.assertActive?.()

      console.info('[MediaIdentity] save-file:success', { id, ext: media.ext, path: mediaPath })
      return true
    } catch (error) {
      console.error('[MediaIdentity] save-file:failed', { id, ext: media.ext }, error)
      return false
    }
  }

  /**
   * 从项目加载媒体文件
   * @param media 媒体 ID 和原文件扩展名
   * @returns 媒体文件
   */
  async loadMediaFile(
    media: MediaFileReference | UnifiedMediaItemData,
    options: MediaReadOptions = {},
  ): Promise<File> {
    const context =
      options.context ?? ('source' in media ? this.contextForAsset(media) : this.captureContext())
    context.assertActive?.()
    options.signal?.throwIfAborted()
    if ('source' in media && media.source.type === 'linked-file') {
      const record = media.source.record
      const workspaceKey = context.workspaceKey ?? fileSystemService.workspaceKey
      if (!workspaceKey) throw new Error('工作区不可用')
      const reader =
        options.linkedReader ??
        createLinkedMediaReader({ ...context, workspaceKey }, fileSystemService)
      const file = await reader.read(media)
      if (options.verifyContent && record) await verifyLinkedContent(record, file, options.signal)
      if (media.source.type !== 'linked-file' || media.source.record !== record)
        throw new Error('链接来源已变化')
      context.assertActive?.()
      options.signal?.throwIfAborted()
      return file
    }
    const { id } = media
    try {
      console.info('[MediaIdentity] load-file:start', {
        projectId: context.projectId,
        id,
        ext: media.ext,
      })
      const mediaPath = fileSystemService.paths.getMediaPath(context.projectId, media)
      const blob = await fileSystemService.readFileAsBlob(mediaPath)
      context.assertActive?.()
      options.signal?.throwIfAborted()
      const file = new File([blob], getMediaFileName(media), { type: blob.type })

      console.info('[MediaIdentity] load-file:success', {
        id,
        ext: media.ext,
        path: mediaPath,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
      })
      return file
    } catch (error) {
      console.error('[MediaIdentity] load-file:failed', { id, ext: media.ext }, error)
      throw new Error(`加载媒体文件失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * 验证媒体文件是否存在
   * @param media 媒体 ID 和原文件扩展名
   * @returns 是否存在
   */
  async verifyMediaFileExists(media: MediaFileReference): Promise<boolean> {
    try {
      const mediaPath = fileSystemService.paths.getMediaPath(this.projectId, media)
      const exists = await fileSystemService.fileExists(mediaPath)
      console.info('[MediaIdentity] verify-file', {
        id: media.id,
        ext: media.ext,
        path: mediaPath,
        exists,
      })
      return exists
    } catch (error) {
      console.error('[MediaIdentity] verify-file:failed', { id: media.id, ext: media.ext }, error)
      return false
    }
  }

  /**
   * 验证Meta文件是否存在
   * @param id 媒体ID
   * @returns 是否存在
   */
  async verifyMetaFileExists(id: string): Promise<boolean> {
    try {
      const metaPath = fileSystemService.paths.getMetaPath(this.projectId, id)
      return await fileSystemService.fileExists(metaPath)
    } catch {
      return false
    }
  }

  // ==================== Meta文件操作 ====================

  /**
   * 保存 Meta 文件
   * @param mediaItem 媒体项目数据
   * @returns 是否成功
   */
  async saveMetaFile(
    asset: UnifiedLibraryAssetData,
    context: MediaPersistenceContext = this.contextForAsset(asset),
    linkedCommit?: LinkedMetaCommit,
  ): Promise<boolean> {
    const workspaceKey = context.workspaceKey ?? fileSystemService.workspaceKey
    const previousSource = isMediaAsset(asset) ? asset.source : undefined
    const assertActive = () => {
      context.assertActive?.()
      if (this.deletingAssets.has(toRaw(asset))) throw new Error('素材已删除或正在删除')
      if (isMediaAsset(asset) && asset.source !== previousSource) throw new Error('链接来源已更新')
    }
    try {
      assertActive()
      console.log(`💾 [globalMetaFileManager] 保存 Meta 文件: ${asset.id}`)

      // 定义终态列表
      const terminalStatuses: MediaStatus[] = ['error', 'cancelled', 'missing']

      const metaData: MediaMetaFile = isMediaAsset(asset)
        ? {
            version: MEDIA_META_VERSION,
            id: asset.id,
            ext: asset.ext,
            name: asset.name,
            createdAt: asset.createdAt,
            assetKind: 'media',
            parentDirectoryId: asset.parentDirectoryId,
            mediaType: asset.mediaType,
            source: extractSourceData(linkedCommit?.source ?? asset.source),
            duration: asset.duration,
            ...(terminalStatuses.includes(asset.mediaStatus) && {
              mediaStatus: asset.mediaStatus as 'error' | 'cancelled' | 'missing',
            }),
            ...(asset.metadata && {
              metadata: JSON.parse(JSON.stringify(asset.metadata)),
            }),
          }
        : {
            version: '1.0.0',
            id: asset.id,
            name: asset.name,
            createdAt: asset.createdAt,
            assetKind: 'effect-template',
            source: extractEffectTemplateSourceData(asset.source),
            effectType: asset.effectType,
            templateStatus: asset.templateStatus,
            ...(asset.templatePayload && {
              templatePayload: JSON.parse(JSON.stringify(asset.templatePayload)),
            }),
          }

      const permissionResult = await fileSystemService.checkPermission()
      assertActive()
      if (!permissionResult.hasAccess) throw new Error('未设置工作目录')

      const mediaDirPath = fileSystemService.paths.getMediaDirPath(context.projectId)
      if (!(await fileSystemService.directoryExists(mediaDirPath))) {
        await fileSystemService.createDirectory(mediaDirPath, { workspaceKey, assertActive })
      }

      const metaPath = fileSystemService.paths.getMetaPath(context.projectId, asset.id)
      const content = JSON.stringify(metaData, null, 2)
      const writeOptions = { workspaceKey, assertActive }
      if (linkedCommit) {
        await fileSystemService.commitLinkedMediaMeta(
          metaPath,
          content,
          writeOptions,
          'initial' in linkedCommit ? 'create' : linkedCommit,
        )
      } else {
        await fileSystemService.writeFile(metaPath, content, writeOptions)
      }

      console.info('[MediaIdentity] save-meta:success', { id: asset.id, path: metaPath })
      return true
    } catch (error) {
      console.error(
        '[MediaIdentity] save-meta:failed',
        { id: asset.id, assetKind: asset.assetKind },
        error,
      )
      return false
    }
  }

  /**
   * 读取 Meta 文件
   * @param id 素材 ID（不含扩展名）
   * @returns Meta 文件数据
   */
  async readMetaFile(id: string): Promise<MediaMetaFile | null> {
    try {
      const metaPath = fileSystemService.paths.getMetaPath(this.projectId, id)
      const content = await fileSystemService.readFile(metaPath)
      return parseLibraryAssetMetaFile(JSON.parse(content) as unknown)
    } catch (error) {
      console.error(`❌ [globalMetaFileManager] 读取 Meta 文件失败: ${id}`, error)
      return null
    }
  }

  /**
   * 扫描所有 Meta 文件
   * @returns Meta 文件数组
   */
  async scanProjectMeta(context: MediaPersistenceContext) {
    const metaFiles: MediaMetaFile[] = []
    const damaged: Omit<MediaLibraryAssetMetaFile, 'source'>[] = []
    let complete = true
    try {
      context.assertActive?.()
      const mediaDirPath = fileSystemService.paths.getMediaDirPath(context.projectId)
      const entries = await fileSystemService.listDirectory(mediaDirPath)
      for (const entry of entries) {
        if (entry.kind !== 'file' || !entry.name.endsWith('.meta')) continue
        context.assertActive?.()
        let value: unknown
        try {
          const content = await fileSystemService.readFile(entry.path)
          // An interrupted create can leave an empty file. A complete read confirms that
          // it cannot reference a binding. A malformed non-empty record remains uncertain.
          if (content.length === 0) continue
          value = JSON.parse(content)
          metaFiles.push(parseLibraryAssetMetaFile(value))
        } catch (error) {
          complete = false
          const invalidLink = readDamagedLinkedMediaMeta(value)
          if (invalidLink) damaged.push(invalidLink)
          console.warn('[MediaIdentity] scan-meta:rejected', { path: entry.path }, error)
        }
      }
      context.assertActive?.()
    } catch (error) {
      complete = false
      console.warn('[MediaIdentity] scan-meta:failed', error)
    }
    return { metaFiles, damaged, complete }
  }

  /** Call under the linked project lock. An incomplete scan must never remove a binding. */
  async reconcileLinkedHandles(
    scope: LinkedProjectScope,
    context: MediaPersistenceContext,
    scanned?: Awaited<ReturnType<GlobalMetaFileManager['scanProjectMeta']>>,
  ) {
    const { complete, metaFiles } = scanned ?? (await this.scanProjectMeta(context))
    if (!complete) return
    context.assertActive?.()
    const referenced = new Set<string>()
    for (const meta of metaFiles) {
      if (meta.assetKind === 'media' && meta.source.type === 'linked-file') {
        referenced.add(meta.source.handleId)
      }
    }
    await pruneLinkedHandles(scope, referenced)
  }

  // ==================== 完整保存流程 ====================

  /**
   * 保存媒体到项目（媒体文件 + Meta文件）
   * 这是导入流程的核心方法，完成文件保存和元数据生成
   *
   * @param mediaItem 媒体项目数据（元数据已在外部设置好）
   * @param file 文件对象（必需）
   * @returns 保存结果
   */
  async saveMediaToProject(
    mediaItem: UnifiedMediaItemData,
    file: File,
    context: MediaPersistenceContext = this.assetContexts.get(toRaw(mediaItem)) ?? {
      projectId: this.projectId,
      workspaceKey: fileSystemService.workspaceKey,
    },
  ): Promise<MediaSaveResult> {
    try {
      context.assertActive?.()
      if (!file) {
        throw new Error('媒体项目缺少文件数据')
      }

      const targetFile = file

      console.log(`💾 [globalMetaFileManager] 开始保存媒体到项目: ${targetFile.name}`)

      // 1. 保存媒体文件到 media/{id}{ext}
      const saveFileSuccess = await this.saveMediaFile(targetFile, mediaItem, context)
      context.assertActive?.()
      if (!saveFileSuccess) {
        throw new Error('保存媒体文件失败')
      }

      // 2. 保存 Meta 文件到 media/{id}.meta
      const saveMetaSuccess = await this.saveMetaFile(mediaItem, context)
      context.assertActive?.()
      if (!saveMetaSuccess) {
        throw new Error('保存 Meta 文件失败')
      }

      console.log(`✅ [globalMetaFileManager] 媒体保存成功: ${targetFile.name} -> ${mediaItem.id}`)

      return {
        success: true,
        mediaId: mediaItem.id,
        storagePath: getMediaPath(mediaItem),
        isReused: false,
      }
    } catch (error) {
      console.error(`❌ [globalMetaFileManager] 保存媒体失败: ${mediaItem.name}`, error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * 删除媒体文件和Meta文件
   * @param media 媒体 ID 和原文件扩展名
   * @returns 删除结果
   */
  async deleteMediaFiles(
    media: MediaFileReference,
    context: MediaPersistenceContext = this.captureContext(),
  ): Promise<{
    success: boolean
    deletedMedia: boolean
    deletedMeta: boolean
    error?: string
  }> {
    const { id } = media
    const options = {
      workspaceKey: context.workspaceKey ?? fileSystemService.workspaceKey,
      assertActive: context.assertActive,
    }
    try {
      console.info('[MediaIdentity] delete:start', {
        projectId: context.projectId,
        id,
        ext: media.ext,
      })

      let deletedMedia = false
      let deletedMeta = false
      let mediaExists = false
      let metaExists = false
      let mediaDeleteFailed = false
      let metaDeleteFailed = false

      // 1. 删除媒体文件
      try {
        const mediaPath = fileSystemService.paths.getMediaPath(context.projectId, media)
        mediaExists = await fileSystemService.fileExists(mediaPath)

        if (mediaExists) {
          await fileSystemService.deleteFile(mediaPath, options)
          deletedMedia = true
          console.log(`✅ [globalMetaFileManager] 媒体文件已删除: ${id}`)
        } else {
          console.warn(`⚠️ [globalMetaFileManager] 媒体文件不存在: ${id}`)
        }
      } catch (error) {
        console.error('[MediaIdentity] delete-file:failed', { id, ext: media.ext }, error)
        mediaDeleteFailed = true
      }

      // 2. 删除Meta文件
      try {
        const metaPath = fileSystemService.paths.getMetaPath(context.projectId, id)
        metaExists = await fileSystemService.fileExists(metaPath)

        if (metaExists) {
          await fileSystemService.deleteFile(metaPath, options)
          deletedMeta = true
          console.log(`✅ [globalMetaFileManager] Meta文件已删除: ${id}.meta`)
        } else {
          console.warn(`⚠️ [globalMetaFileManager] Meta文件不存在: ${id}.meta`)
        }
      } catch (error) {
        console.error('[MediaIdentity] delete-meta:failed', { id }, error)
        metaDeleteFailed = true
      }

      // 3. 只有所有已存在文件都成功删除，才允许上层删除内存素材和目录归属。
      const success =
        !mediaDeleteFailed &&
        !metaDeleteFailed &&
        (!mediaExists || deletedMedia) &&
        (!metaExists || deletedMeta)

      console.info('[MediaIdentity] delete:result', {
        id,
        ext: media.ext,
        success,
        mediaExists,
        metaExists,
        deletedMedia,
        deletedMeta,
      })

      return {
        success,
        deletedMedia,
        deletedMeta,
        ...(success ? {} : { error: '媒体文件或 Meta 文件删除失败' }),
      }
    } catch (error) {
      console.error('[MediaIdentity] delete:failed', { id, ext: media.ext }, error)
      return {
        success: false,
        deletedMedia: false,
        deletedMeta: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async deleteAssetFiles(asset: UnifiedLibraryAssetData): Promise<{
    success: boolean
    deletedMedia: boolean
    deletedMeta: boolean
    error?: string
  }> {
    if (isMediaAsset(asset)) {
      const context = this.contextForAsset(asset)
      const workspaceKey = context.workspaceKey ?? fileSystemService.workspaceKey
      this.assertAssetActive(asset)
      this.deletingAssets.add(toRaw(asset))
      if (asset.source.type !== 'linked-file') {
        const result = await this.deleteMediaFiles(asset, context)
        if (!result.success) this.deletingAssets.delete(toRaw(asset))
        return result
      }
      try {
        if (!workspaceKey) throw new Error('工作区不可用')
        const scope = { projectId: context.projectId, workspaceKey }
        await withLinkedProjectLock(scope, async () => {
          context.assertActive?.()
          const path = fileSystemService.paths.getMetaPath(scope.projectId, asset.id)
          if (await fileSystemService.fileExists(path)) {
            await fileSystemService.deleteFile(path, {
              workspaceKey,
              assertActive: context.assertActive,
            })
          }
          await this.reconcileLinkedHandles(scope, context).catch((error) => {
            console.warn('链接句柄回收将延后到下次打开工程', error)
          })
        })
        return { success: true, deletedMedia: false, deletedMeta: true }
      } catch (error) {
        this.deletingAssets.delete(toRaw(asset))
        return { success: false, deletedMedia: false, deletedMeta: false, error: String(error) }
      }
    }

    try {
      const packageDirPath = fileSystemService.paths.getProjectEffectPackageDirPath(
        this.projectId,
        asset.id,
      )
      const packageDirExists = await fileSystemService.directoryExists(packageDirPath)
      if (packageDirExists) {
        await fileSystemService.deleteDirectory(packageDirPath, true)
      }

      const metaPath = fileSystemService.paths.getMetaPath(this.projectId, asset.id)
      const metaExists = await fileSystemService.fileExists(metaPath)
      if (metaExists) {
        await fileSystemService.deleteFile(metaPath)
      }

      return {
        success: packageDirExists || metaExists,
        deletedMedia: packageDirExists,
        deletedMeta: metaExists,
      }
    } catch (error) {
      console.error(`❌ [globalMetaFileManager] 删除资产 Meta 文件失败: ${asset.id}.meta`, error)
      return {
        success: false,
        deletedMedia: false,
        deletedMeta: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  // ==================== 辅助方法 ====================
}

// 导出全局实例
export const globalMetaFileManager = new GlobalMetaFileManager()
