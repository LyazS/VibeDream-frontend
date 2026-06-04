import { toPackageVersionPathSegment } from '@/core/effect-template/commonTypes'
import type { ParsedPath } from './types'

/**
 * 统一的路径解析和管理
 * 这个类不依赖具体的存储实现
 */
export class PathResolver {
  private readonly PROJECTS_DIR = 'projects'
  private readonly COMMON_EFFECTS_DIR = 'common_effects'
  private readonly EFFECT_CATALOGS_DIR = 'catalogs'
  private readonly EFFECT_PACKAGES_DIR = 'packages'
  private readonly MEDIA_DIR = 'media'
  private readonly THUMBNAILS_DIR = 'thumbnails'

  // ==================== 路径构建 ====================

  /**
   * 连接路径片段
   */
  join(...parts: string[]): string {
    return parts
      .filter((part) => part && part !== '.')
      .join('/')
      .replace(/\/+/g, '/')
  }

  /**
   * 解析路径
   */
  resolve(path: string): string {
    // 移除开头的 /
    return path.replace(/^\/+/, '')
  }

  // ==================== 路径解析 ====================

  /**
   * 解析路径为各个部分
   */
  parse(path: string): ParsedPath {
    const normalized = this.resolve(path)
    const parts = normalized.split('/')
    const basename = parts[parts.length - 1]
    const extIndex = basename.lastIndexOf('.')

    return {
      dir: parts.slice(0, -1).join('/'),
      base: basename,
      ext: extIndex > 0 ? basename.slice(extIndex) : '',
      name: extIndex > 0 ? basename.slice(0, extIndex) : basename,
    }
  }

  dirname(path: string): string {
    return this.parse(path).dir
  }

  basename(path: string): string {
    return this.parse(path).base
  }

  extname(path: string): string {
    return this.parse(path).ext
  }

  // ==================== 预定义路径 ====================

  /**
   * 获取项目目录路径
   */
  getProjectPath(projectId: string): string {
    return this.join(this.PROJECTS_DIR, projectId)
  }

  getCommonEffectsDirPath(): string {
    return this.COMMON_EFFECTS_DIR
  }

  getEffectCatalogDirPath(): string {
    return this.join(this.getCommonEffectsDirPath(), this.EFFECT_CATALOGS_DIR)
  }

  getEffectCatalogPath(effectType: 'transition' | 'filter'): string {
    return this.join(this.getEffectCatalogDirPath(), `${effectType}.json`)
  }

  getEffectIndexPath(): string {
    return this.join(this.getCommonEffectsDirPath(), 'index.json')
  }

  getEffectPackageDirPath(
    effectType: 'transition' | 'filter',
    templateId: string,
    packageVersion: string,
  ): string {
    return this.join(
      this.getCommonEffectsDirPath(),
      this.EFFECT_PACKAGES_DIR,
      effectType,
      templateId,
      toPackageVersionPathSegment(packageVersion),
    )
  }

  getEffectPackageMetaPath(
    effectType: 'transition' | 'filter',
    templateId: string,
    packageVersion: string,
  ): string {
    return this.join(
      this.getEffectPackageDirPath(effectType, templateId, packageVersion),
      '.effect-template-meta.json',
    )
  }

  /**
   * 获取项目配置文件路径
   */
  getProjectConfigPath(projectId: string): string {
    return this.join(this.getProjectPath(projectId), 'project.json')
  }

  /**
   * 获取项目时间轴文件路径
   */
  getProjectTimelinePath(projectId: string): string {
    return this.join(this.getProjectPath(projectId), 'timeline.json')
  }

  /**
   * 获取项目目录配置文件路径
   */
  getProjectDirectoriesPath(projectId: string): string {
    return this.join(this.getProjectPath(projectId), 'directories.json')
  }

  /**
   * 获取媒体目录路径
   */
  getMediaDirPath(projectId: string): string {
    return this.join(this.getProjectPath(projectId), this.MEDIA_DIR)
  }

  /**
   * 获取媒体文件路径
   */
  getMediaPath(projectId: string, mediaId: string): string {
    return this.join(this.getMediaDirPath(projectId), mediaId)
  }

  /**
   * 获取Meta文件路径
   */
  getMetaPath(projectId: string, mediaId: string): string {
    return this.join(this.getMediaDirPath(projectId), `${mediaId}.meta`)
  }

  /**
   * 获取缩略图目录路径
   */
  getThumbnailDirPath(projectId: string): string {
    return this.join(this.getProjectPath(projectId), this.THUMBNAILS_DIR)
  }

  /**
   * 获取项目缩略图路径
   */
  getThumbnailPath(projectId: string): string {
    return this.join(this.getThumbnailDirPath(projectId), 'projectThumbnail.webp')
  }
}
