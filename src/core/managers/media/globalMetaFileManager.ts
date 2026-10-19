import { fileSystemService } from '@/core/managers/filesystem/fileSystemService'
import {
  MEDIA_META_VERSION,
  parseLibraryAssetMetaFile,
  type MediaMetaFile,
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
  assertActive?: () => void
}

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

  /**
   * 初始化管理器
   * @param projectId 项目ID
   */
  async initialize(projectId: string): Promise<void> {
    this.projectId = projectId
    console.log(`🔧 [globalMetaFileManager] 初始化: ${projectId}`)
  }

  /**
   * 获取当前项目ID
   */
  get currentProjectId(): string {
    return this.projectId
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
    context: MediaPersistenceContext = { projectId: this.projectId },
  ): Promise<boolean> {
    const { id } = media
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
        await fileSystemService.createDirectory(mediaDirPath)
        context.assertActive?.()
      }

      // 保存文件
      const mediaPath = fileSystemService.paths.getMediaPath(context.projectId, media)
      await fileSystemService.writeFile(mediaPath, file)
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
  async loadMediaFile(media: MediaFileReference): Promise<File> {
    const { id } = media
    try {
      console.info('[MediaIdentity] load-file:start', {
        projectId: this.projectId,
        id,
        ext: media.ext,
      })
      const mediaPath = fileSystemService.paths.getMediaPath(this.projectId, media)
      const blob = await fileSystemService.readFileAsBlob(mediaPath)
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
    context: MediaPersistenceContext = { projectId: this.projectId },
  ): Promise<boolean> {
    try {
      context.assertActive?.()
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
            source: extractSourceData(asset.source),
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

      // 2. 检查工作空间权限
      const permissionResult = await fileSystemService.checkPermission()
      context.assertActive?.()
      if (!permissionResult.hasAccess) throw new Error('未设置工作目录')

      // 3. 确保 media 目录存在
      const mediaDirPath = fileSystemService.paths.getMediaDirPath(context.projectId)
      const mediaDirExists = await fileSystemService.directoryExists(mediaDirPath)
      context.assertActive?.()
      if (!mediaDirExists) {
        await fileSystemService.createDirectory(mediaDirPath)
        context.assertActive?.()
      }

      // 4. 写入 meta 文件
      const metaPath = fileSystemService.paths.getMetaPath(context.projectId, asset.id)
      console.info('[MediaIdentity] save-meta:start', {
        id: asset.id,
        ext: isMediaAsset(asset) ? asset.ext : undefined,
        name: asset.name,
        version: metaData.version,
        assetKind: asset.assetKind,
        path: metaPath,
      })
      await fileSystemService.writeFile(metaPath, JSON.stringify(metaData, null, 2))
      context.assertActive?.()

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
  async scanAllMetaFiles(): Promise<MediaMetaFile[]> {
    try {
      const mediaDirPath = fileSystemService.paths.getMediaDirPath(this.projectId)
      const entries = await fileSystemService.listDirectory(mediaDirPath)

      const metaFiles: MediaMetaFile[] = []

      for (const entry of entries) {
        if (entry.kind === 'file' && entry.name.endsWith('.meta')) {
          try {
            const content = await fileSystemService.readFile(entry.path)
            const metaData = parseLibraryAssetMetaFile(JSON.parse(content) as unknown)
            console.info('[MediaIdentity] scan-meta:accepted', {
              id: metaData.id,
              ext: metaData.assetKind === 'media' ? metaData.ext : undefined,
              version: metaData.version,
              path: entry.path,
            })
            metaFiles.push(metaData)
          } catch (error) {
            console.warn('[MediaIdentity] scan-meta:rejected', { path: entry.path }, error)
          }
        }
      }

      console.log(`📄 [globalMetaFileManager] 扫描到 ${metaFiles.length} 个 Meta 文件`)
      return metaFiles
    } catch (error) {
      console.error('❌ [globalMetaFileManager] 扫描 Meta 文件失败:', error)
      return []
    }
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
    context: MediaPersistenceContext = { projectId: this.projectId },
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
  async deleteMediaFiles(media: MediaFileReference): Promise<{
    success: boolean
    deletedMedia: boolean
    deletedMeta: boolean
    error?: string
  }> {
    const { id } = media
    try {
      console.info('[MediaIdentity] delete:start', {
        projectId: this.projectId,
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
        const mediaPath = fileSystemService.paths.getMediaPath(this.projectId, media)
        mediaExists = await fileSystemService.fileExists(mediaPath)

        if (mediaExists) {
          await fileSystemService.deleteFile(mediaPath)
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
        const metaPath = fileSystemService.paths.getMetaPath(this.projectId, id)
        metaExists = await fileSystemService.fileExists(metaPath)

        if (metaExists) {
          await fileSystemService.deleteFile(metaPath)
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
      return this.deleteMediaFiles(asset)
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
