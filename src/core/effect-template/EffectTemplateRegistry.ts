import { reactive } from 'vue'
import { fileSystemService } from '@/core/managers/filesystem/fileSystemService'
import { effectPackageRegistry } from '@/core/effect-package/EffectPackageRegistry'
import type { LoadedEffectPackage } from '@/core/effect-package/types'
import type {
  CommonEffectCatalog,
  CommonEffectIndexEntry,
  CommonEffectIndexFile,
  CommonEffectTemplateMeta,
  FilterTemplateSummary,
  TransitionTemplateSummary,
} from '@/core/effect-template/catalogTypes'
import {
  assertCatalogVersion,
  assertPackageVersion,
  buildEffectPackageId,
  fromPackageVersionPathSegment,
  parseEffectPackageId,
  type CommonEffectTemplateStatus,
  type CommonEffectType,
  type EffectInstallPhase,
  type EffectPackageIdentity,
} from '@/core/effect-template/commonTypes'
import { filterTemplateCatalogService } from '@/core/effect-template/FilterTemplateCatalogService'
import { transitionTemplateCatalogService } from '@/core/effect-template/TransitionTemplateCatalogService'

type CatalogItemByType<T extends CommonEffectType> =
  T extends 'transition' ? TransitionTemplateSummary : FilterTemplateSummary

type CatalogItem = TransitionTemplateSummary | FilterTemplateSummary
const CATALOG_VERSION_CHECK_TTL_MS = 5 * 60 * 1000

export interface CommonEffectTemplateState {
  effectPackageId: string
  effectType: CommonEffectType
  templateId: string
  packageVersion: string
  catalogVersion: string
  status: CommonEffectTemplateStatus
  phase: EffectInstallPhase
  progress: number
  errorMessage?: string
  packagePath?: string
  meta?: CommonEffectTemplateMeta
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toLocalizedText(value: unknown): { zh: string; en: string } {
  if (isRecord(value)) {
    return {
      zh: String(value.zh ?? '').trim(),
      en: String(value.en ?? '').trim(),
    }
  }
  return { zh: '', en: '' }
}

function toLocalizedTagList(value: unknown): { zh: string[]; en: string[] } {
  if (isRecord(value)) {
    return {
      zh: Array.isArray(value.zh) ? value.zh.map((item) => String(item)) : [],
      en: Array.isArray(value.en) ? value.en.map((item) => String(item)) : [],
    }
  }
  return { zh: [], en: [] }
}

function normalizeProgress(phase: EffectInstallPhase): number {
  switch (phase) {
    case 'downloading':
      return 25
    case 'writing':
      return 60
    case 'validating':
      return 85
    case 'ready':
      return 100
    case 'error':
      return 0
    case 'idle':
    default:
      return 0
  }
}

export class EffectTemplateRegistry {
  readonly packageStates = reactive(new Map<string, CommonEffectTemplateState>())

  private readonly catalogs = reactive(new Map<CommonEffectType, CommonEffectCatalog<any>>())
  private readonly activeInstalls = new Map<string, Promise<void>>()
  private initialized = false

  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    await this.ensureBaseDirectories()
    await this.rebuildStateFromDisk()
    this.initialized = true
  }

  async loadCatalog<T extends CommonEffectType>(
    effectType: T,
  ): Promise<CommonEffectCatalog<CatalogItemByType<T>>> {
    await this.initialize()

    const cachedCatalog = await this.readCatalogFile(effectType)
    if (cachedCatalog) {
      this.applyCatalog(cachedCatalog)
    }

    if (cachedCatalog && this.isCatalogVersionCheckFresh(cachedCatalog.checkedAt)) {
      return cachedCatalog as CommonEffectCatalog<CatalogItemByType<T>>
    }

    try {
      const versionResponse = effectType === 'transition'
        ? await transitionTemplateCatalogService.getCatalogVersion()
        : await filterTemplateCatalogService.getCatalogVersion()
      const remoteCatalogVersion = assertCatalogVersion(versionResponse.catalog_version)
      const checkedAt = new Date().toISOString()

      if (cachedCatalog && cachedCatalog.catalogVersion === remoteCatalogVersion) {
        const refreshedCatalog: CommonEffectCatalog<CatalogItemByType<T>> = {
          ...cachedCatalog,
          checkedAt,
        }
        await this.persistCatalogFile(refreshedCatalog)
        this.applyCatalog(refreshedCatalog)
        return refreshedCatalog
      }

      const response = effectType === 'transition'
        ? await transitionTemplateCatalogService.getTemplateSummaries()
        : await filterTemplateCatalogService.getTemplateSummaries()
      const catalogVersion = assertCatalogVersion(response.catalog_version)
      const catalog: CommonEffectCatalog<CatalogItemByType<T>> = {
        effectType,
        catalogVersion,
        checkedAt,
        items: response.items as CatalogItemByType<T>[],
      }

      await this.persistCatalogFile(catalog)
      this.applyCatalog(catalog)
      return catalog
    } catch (error) {
      if (cachedCatalog) {
        return cachedCatalog as CommonEffectCatalog<CatalogItemByType<T>>
      }
      throw error
    }
  }

  async installLatest(effectType: CommonEffectType, templateId: string): Promise<void> {
    const catalog = await this.loadCatalog(effectType)
    const item = catalog.items.find((entry) => entry.id === templateId)
    if (!item) {
      throw new Error(`效果模板不存在: ${effectType}/${templateId}`)
    }
    return this.installTemplate(effectType, templateId, item.package_version, catalog.catalogVersion)
  }

  async installTemplate(
    effectType: CommonEffectType,
    templateId: string,
    packageVersion: string,
    catalogVersion: string,
  ): Promise<void> {
    await this.initialize()
    const identity = this.createIdentity(effectType, templateId, packageVersion, catalogVersion)
    const existingTask = this.activeInstalls.get(identity.effectPackageId)
    if (existingTask) {
      return existingTask
    }

    const task = this.installTemplateInternal(identity)
      .finally(() => {
        this.activeInstalls.delete(identity.effectPackageId)
      })
    this.activeInstalls.set(identity.effectPackageId, task)
    return task
  }

  async ensureReady(identityOrEffectPackageId: EffectPackageIdentity | string): Promise<void> {
    await this.initialize()
    const identity = typeof identityOrEffectPackageId === 'string'
      ? parseEffectPackageId(identityOrEffectPackageId)
      : identityOrEffectPackageId
    const readyPackage = effectPackageRegistry.getPackage(identity.effectPackageId)
    if (readyPackage && this.packageStates.get(identity.effectPackageId)?.status === 'ready') {
      return
    }

    const currentState = this.packageStates.get(identity.effectPackageId)
    if (currentState?.status === 'ready' && currentState.packagePath) {
      await this.loadInstalledPackage(identity, currentState.packagePath)
      return
    }

    if (
      currentState?.packagePath &&
      (currentState.status === 'installed' || currentState.status === 'loading')
    ) {
      await this.loadInstalledPackage(identity, currentState.packagePath)
      return
    }

    const resolvedIdentity = await this.resolveInstallIdentity(identity)
    if (!resolvedIdentity) {
      const fallbackIdentity = currentState
        ? this.createIdentity(
            currentState.effectType,
            currentState.templateId,
            currentState.packageVersion,
            currentState.catalogVersion,
          )
        : identity
      this.setState(fallbackIdentity, {
        status: 'missing',
        phase: 'error',
        progress: 0,
        errorMessage: '指定版本的效果模板不存在',
      })
      await this.persistIndexFile()
      return
    }

    await this.installTemplate(
      resolvedIdentity.effectType,
      resolvedIdentity.templateId,
      resolvedIdentity.packageVersion,
      resolvedIdentity.catalogVersion,
    )
  }

  getReadyPackage(effectPackageId: string): LoadedEffectPackage | null {
    return effectPackageRegistry.getPackage(effectPackageId)
  }

  getPackageState(effectPackageId: string): CommonEffectTemplateState | undefined {
    return this.packageStates.get(effectPackageId)
  }

  listStatesByType(effectType: CommonEffectType): CommonEffectTemplateState[] {
    return Array.from(this.packageStates.values())
      .filter((state) => state.effectType === effectType)
      .sort((a, b) => a.templateId.localeCompare(b.templateId))
  }

  private createIdentity(
    effectType: CommonEffectType,
    templateId: string,
    packageVersion: string,
    catalogVersion: string,
  ): EffectPackageIdentity {
    const normalizedPackageVersion = assertPackageVersion(packageVersion)
    return {
      effectType,
      templateId,
      packageVersion: normalizedPackageVersion,
      catalogVersion: assertCatalogVersion(catalogVersion),
      effectPackageId: buildEffectPackageId(effectType, templateId, normalizedPackageVersion),
    }
  }

  private createMetaFromCatalogItem(
    identity: EffectPackageIdentity,
    item: CatalogItem,
    installedAt: string,
  ): CommonEffectTemplateMeta {
    const transitionDurationFrames = 'duration_frames' in item ? item.duration_frames : undefined
    const supportedMediaTypes = 'supported_media_types' in item
      ? [...item.supported_media_types]
      : undefined

    return {
      effectPackageId: identity.effectPackageId,
      effectType: identity.effectType,
      templateId: identity.templateId,
      packageVersion: identity.packageVersion,
      catalogVersion: identity.catalogVersion,
      name: item.name,
      summary: item.summary,
      tags: item.tags,
      coverUrl: item.cover_url ?? '',
      installedAt,
      ...(transitionDurationFrames !== undefined ? { transitionDurationFrames } : {}),
      ...(supportedMediaTypes ? { supportedMediaTypes } : {}),
    }
  }

  private setState(
    identity: EffectPackageIdentity,
    patch: Partial<CommonEffectTemplateState>,
  ): CommonEffectTemplateState {
    const previous = this.packageStates.get(identity.effectPackageId)
    const nextState: CommonEffectTemplateState = {
      effectPackageId: identity.effectPackageId,
      effectType: identity.effectType,
      templateId: identity.templateId,
      packageVersion: identity.packageVersion,
      catalogVersion: identity.catalogVersion,
      status: previous?.status ?? 'remote',
      phase: previous?.phase ?? 'idle',
      progress: previous?.progress ?? 0,
      ...previous,
      ...patch,
    }
    this.packageStates.set(identity.effectPackageId, nextState)
    return nextState
  }

  private async installTemplateInternal(identity: EffectPackageIdentity): Promise<void> {
    const item = await this.resolveCatalogItem(identity)
    if (!item) {
      this.setState(identity, {
        status: 'missing',
        phase: 'error',
        progress: 0,
        errorMessage: '指定版本的效果模板不存在',
      })
      await this.persistIndexFile()
      return
    }

    const packagePath = fileSystemService.paths.getEffectPackageDirPath(
      identity.effectType,
      identity.templateId,
      identity.packageVersion,
    )
    this.setState(identity, {
      status: 'installing',
      phase: 'downloading',
      progress: normalizeProgress('downloading'),
      errorMessage: undefined,
      packagePath,
    })

    try {
      const download = identity.effectType === 'transition'
        ? await transitionTemplateCatalogService.downloadTemplatePackage(
            identity.templateId,
            identity.catalogVersion,
          )
        : await filterTemplateCatalogService.downloadTemplatePackage(
            identity.templateId,
            identity.catalogVersion,
          )

      const downloadCatalogVersion = assertCatalogVersion(download.catalog_version)
      if (downloadCatalogVersion !== identity.catalogVersion) {
        throw new Error(
          `效果模板目录版本不一致: request=${identity.catalogVersion}, response=${downloadCatalogVersion}`,
        )
      }

      const downloadPackageVersion = assertPackageVersion(download.package_manifest.version)
      if (downloadPackageVersion !== identity.packageVersion) {
        throw new Error(
          `效果包版本不一致: request=${identity.packageVersion}, response=${downloadPackageVersion}`,
        )
      }

      this.setState(identity, {
        status: 'installing',
        phase: 'writing',
        progress: normalizeProgress('writing'),
      })

      const packageDirExists = await fileSystemService.directoryExists(packagePath).catch(() => false)
      if (packageDirExists) {
        await fileSystemService.deleteDirectory(packagePath, true)
      }
      await fileSystemService.createDirectory(packagePath)
      await effectPackageRegistry.writePackageFiles(packagePath, download.package_files)

      this.setState(identity, {
        status: 'installing',
        phase: 'validating',
        progress: normalizeProgress('validating'),
      })

      const loaded = await effectPackageRegistry.loadCommonPackageDirectory(
        packagePath,
        identity.effectPackageId,
      )
      if (!loaded) {
        throw new Error(`下载的 effect package 无法加载: ${identity.effectPackageId}`)
      }

      const installedAt = new Date().toISOString()
      const meta = this.createMetaFromCatalogItem(identity, item, installedAt)
      await fileSystemService.writeFile(
        fileSystemService.paths.getEffectPackageMetaPath(
          identity.effectType,
          identity.templateId,
          identity.packageVersion,
        ),
        JSON.stringify(meta, null, 2),
      )

      this.setState(identity, {
        status: 'ready',
        phase: 'ready',
        progress: normalizeProgress('ready'),
        meta,
        packagePath,
        errorMessage: undefined,
      })
      await this.persistIndexFile()
    } catch (error) {
      await this.cleanupFailedInstall(identity, packagePath).catch(() => {})
      const message = error instanceof Error ? error.message : String(error)
      const status = /不存在|404|409|不匹配/.test(message) ? 'missing' : 'error'
      this.setState(identity, {
        status,
        phase: 'error',
        progress: normalizeProgress('error'),
        errorMessage: message,
        packagePath,
      })
      await this.persistIndexFile()
      throw error
    }
  }

  private async cleanupFailedInstall(identity: EffectPackageIdentity, packagePath: string): Promise<void> {
    effectPackageRegistry.removePackage(identity.effectPackageId)
    const packageDirExists = await fileSystemService.directoryExists(packagePath).catch(() => false)
    if (packageDirExists) {
      await fileSystemService.deleteDirectory(packagePath, true)
    }
  }

  private async ensureBaseDirectories(): Promise<void> {
    const commonEffectsDir = fileSystemService.paths.getCommonEffectsDirPath()
    const catalogDir = fileSystemService.paths.getEffectCatalogDirPath()
    const packageRootDir = fileSystemService.paths.join(
      commonEffectsDir,
      'packages',
    )

    if (!(await fileSystemService.directoryExists(commonEffectsDir).catch(() => false))) {
      await fileSystemService.createDirectory(commonEffectsDir)
    }
    if (!(await fileSystemService.directoryExists(catalogDir).catch(() => false))) {
      await fileSystemService.createDirectory(catalogDir)
    }
    if (!(await fileSystemService.directoryExists(packageRootDir).catch(() => false))) {
      await fileSystemService.createDirectory(packageRootDir)
    }
  }

  private async readCatalogFile<T extends CommonEffectType>(
    effectType: T,
  ): Promise<CommonEffectCatalog<CatalogItemByType<T>> | null> {
    const catalogPath = fileSystemService.paths.getEffectCatalogPath(effectType)
    if (!(await fileSystemService.fileExists(catalogPath).catch(() => false))) {
      return null
    }

    try {
      const raw = JSON.parse(await fileSystemService.readFile(catalogPath)) as unknown
      if (!isRecord(raw) || !Array.isArray(raw.items)) {
        return null
      }

      const rawEffectType = raw.effectType === 'filter' ? 'filter' : raw.effectType === 'transition'
        ? 'transition'
        : null
      if (rawEffectType !== effectType) {
        return null
      }

      return {
        effectType,
        catalogVersion: assertCatalogVersion(String(raw.catalogVersion ?? '')),
        checkedAt: typeof raw.checkedAt === 'string' && raw.checkedAt.trim()
          ? raw.checkedAt
          : undefined,
        items: raw.items as CatalogItemByType<T>[],
      }
    } catch (error) {
      console.warn(`[EffectTemplateRegistry] 读取 ${effectType} catalog 缓存失败:`, error)
      return null
    }
  }

  private async persistCatalogFile<TItem extends CatalogItem>(
    catalog: CommonEffectCatalog<TItem>,
  ): Promise<void> {
    await fileSystemService.writeFile(
      fileSystemService.paths.getEffectCatalogPath(catalog.effectType),
      JSON.stringify(catalog, null, 2),
    )
  }

  private applyCatalog<TItem extends CatalogItem>(catalog: CommonEffectCatalog<TItem>): void {
    this.catalogs.set(catalog.effectType, catalog)
    this.syncCatalogStates(catalog.effectType, catalog.items, catalog.catalogVersion)
  }

  private isCatalogVersionCheckFresh(checkedAt?: string): boolean {
    if (!checkedAt) {
      return false
    }
    const checkedAtMs = Date.parse(checkedAt)
    if (!Number.isFinite(checkedAtMs)) {
      return false
    }
    return Date.now() - checkedAtMs < CATALOG_VERSION_CHECK_TTL_MS
  }

  private async rebuildStateFromDisk(): Promise<void> {
    this.packageStates.clear()
    effectPackageRegistry.clear()

    const indexFile = await this.readIndexFile()
    if (indexFile) {
      for (const entry of indexFile.packages) {
        const packageDirExists = entry.packagePath
          ? await fileSystemService.directoryExists(entry.packagePath).catch(() => false)
          : false
        if (!packageDirExists) {
          continue
        }
        const identity = this.createIdentity(
          entry.effectType,
          entry.templateId,
          entry.packageVersion,
          entry.catalogVersion,
        )
        this.setState(identity, {
          status: entry.status === 'ready' ? 'installed' : entry.status,
          phase: entry.status === 'ready' || entry.status === 'installed' ? 'idle' : 'error',
          progress: 0,
          packagePath: entry.packagePath,
          errorMessage: entry.errorMessage,
        })
      }
    }

    await this.scanPackageDirectories()
    await this.persistIndexFile()
  }

  private async scanPackageDirectories(): Promise<void> {
    for (const effectType of ['transition', 'filter'] as const) {
      const typeDir = fileSystemService.paths.join(
        fileSystemService.paths.getCommonEffectsDirPath(),
        'packages',
        effectType,
      )
      if (!(await fileSystemService.directoryExists(typeDir).catch(() => false))) {
        continue
      }

      const templateDirs = await fileSystemService.listDirectory(typeDir)
      for (const templateDir of templateDirs) {
        if (templateDir.kind !== 'directory') {
          continue
        }
        const versionDirs = await fileSystemService.listDirectory(templateDir.path)
        for (const versionDir of versionDirs) {
          if (versionDir.kind !== 'directory') {
            continue
          }
          const metaIdentity = this.createIdentity(
            effectType,
            templateDir.name,
            fromPackageVersionPathSegment(versionDir.name),
            'local-only',
          )
          const meta = await this.readMetaFile(metaIdentity).catch(() => null)
          const identity = meta
            ? this.createIdentity(effectType, meta.templateId, meta.packageVersion, meta.catalogVersion)
            : metaIdentity
          const manifestPath = fileSystemService.paths.join(versionDir.path, 'manifest.json')
          const hasManifest = await fileSystemService.fileExists(manifestPath).catch(() => false)
          this.setState(identity, {
            status: hasManifest ? 'installed' : 'error',
            phase: hasManifest ? 'idle' : 'error',
            progress: 0,
            packagePath: versionDir.path,
            meta: meta ?? undefined,
            errorMessage: hasManifest ? undefined : '本地效果包缺少 manifest.json',
          })
        }
      }
    }
  }

  private async readMetaFile(identity: EffectPackageIdentity): Promise<CommonEffectTemplateMeta | null> {
    const metaPath = fileSystemService.paths.getEffectPackageMetaPath(
      identity.effectType,
      identity.templateId,
      identity.packageVersion,
    )
    if (!(await fileSystemService.fileExists(metaPath).catch(() => false))) {
      return null
    }
    const raw = JSON.parse(await fileSystemService.readFile(metaPath)) as unknown
    if (!isRecord(raw)) {
      return null
    }
    return {
      effectPackageId: String(raw.effectPackageId ?? identity.effectPackageId),
      effectType: raw.effectType === 'filter' ? 'filter' : 'transition',
      templateId: String(raw.templateId ?? identity.templateId),
      packageVersion: String(raw.packageVersion ?? identity.packageVersion),
      catalogVersion: String(raw.catalogVersion ?? identity.catalogVersion),
      name: toLocalizedText(raw.name),
      summary: toLocalizedText(raw.summary),
      tags: toLocalizedTagList(raw.tags),
      coverUrl: String(raw.coverUrl ?? ''),
      installedAt: String(raw.installedAt ?? ''),
      transitionDurationFrames: typeof raw.transitionDurationFrames === 'number'
        ? raw.transitionDurationFrames
        : undefined,
      supportedMediaTypes: Array.isArray(raw.supportedMediaTypes)
        ? raw.supportedMediaTypes
          .map((item) => String(item))
          .filter((item): item is 'video' | 'image' => item === 'video' || item === 'image')
        : undefined,
    }
  }

  private async readIndexFile(): Promise<CommonEffectIndexFile | null> {
    const indexPath = fileSystemService.paths.getEffectIndexPath()
    if (!(await fileSystemService.fileExists(indexPath).catch(() => false))) {
      return null
    }

    try {
      const raw = JSON.parse(await fileSystemService.readFile(indexPath)) as unknown
      if (!isRecord(raw) || !Array.isArray(raw.packages)) {
        return null
      }
      return {
        version: String(raw.version ?? '1.0.0'),
        packages: raw.packages.filter(isRecord).map((entry) => ({
          effectPackageId: String(entry.effectPackageId ?? ''),
          effectType: entry.effectType === 'filter' ? 'filter' : 'transition',
          templateId: String(entry.templateId ?? ''),
          packageVersion: String(entry.packageVersion ?? ''),
          catalogVersion: String(entry.catalogVersion ?? ''),
          status:
            entry.status === 'error'
            || entry.status === 'missing'
            || entry.status === 'installed'
              ? entry.status
              : 'ready',
          packagePath: String(entry.packagePath ?? ''),
          installedAt: entry.installedAt ? String(entry.installedAt) : undefined,
          errorMessage: entry.errorMessage ? String(entry.errorMessage) : undefined,
        })),
      }
    } catch (error) {
      console.warn('[EffectTemplateRegistry] 读取 index.json 失败，尝试重建:', error)
      return null
    }
  }

  private async persistIndexFile(): Promise<void> {
    const payload: CommonEffectIndexFile = {
      version: '1.0.0',
      packages: Array.from(this.packageStates.values())
        .filter((state) => state.status !== 'remote')
        .map((state): CommonEffectIndexEntry => ({
          effectPackageId: state.effectPackageId,
          effectType: state.effectType,
          templateId: state.templateId,
          packageVersion: state.packageVersion,
          catalogVersion: state.catalogVersion,
          status:
            state.status === 'ready'
              ? 'ready'
              : state.status === 'installed' || state.status === 'loading'
                ? 'installed'
                : state.status === 'missing'
                  ? 'missing'
                  : 'error',
          packagePath: state.packagePath ?? fileSystemService.paths.getEffectPackageDirPath(
            state.effectType,
            state.templateId,
            state.packageVersion,
          ),
          installedAt: state.meta?.installedAt,
          errorMessage: state.errorMessage,
        })),
    }

    await fileSystemService.writeFile(
      fileSystemService.paths.getEffectIndexPath(),
      JSON.stringify(payload, null, 2),
    )
  }

  private async resolveCatalogItem(identity: EffectPackageIdentity): Promise<CatalogItem | null> {
    const currentCatalog = this.catalogs.get(identity.effectType)
    if (currentCatalog?.catalogVersion === identity.catalogVersion) {
      return currentCatalog.items.find((item) =>
        item.id === identity.templateId && item.package_version === identity.packageVersion,
      ) ?? null
    }

    const loadedCatalog = await this.loadCatalog(identity.effectType)
    if (loadedCatalog.catalogVersion !== identity.catalogVersion) {
      return null
    }
    return loadedCatalog.items.find((item) =>
      item.id === identity.templateId && item.package_version === identity.packageVersion,
    ) ?? null
  }

  private async resolveInstallIdentity(identity: EffectPackageIdentity): Promise<EffectPackageIdentity | null> {
    const currentState = this.packageStates.get(identity.effectPackageId)
    if (currentState?.catalogVersion && currentState.catalogVersion !== 'local-only') {
      return this.createIdentity(
        currentState.effectType,
        currentState.templateId,
        currentState.packageVersion,
        currentState.catalogVersion,
      )
    }

    const catalog = await this.loadCatalog(identity.effectType)
    const item = catalog.items.find((entry) =>
      entry.id === identity.templateId && entry.package_version === identity.packageVersion,
    )
    if (!item) {
      return null
    }
    return this.createIdentity(
      identity.effectType,
      identity.templateId,
      item.package_version,
      catalog.catalogVersion,
    )
  }

  private syncCatalogStates(
    effectType: CommonEffectType,
    items: Array<TransitionTemplateSummary | FilterTemplateSummary>,
    catalogVersion: string,
  ): void {
    const activeEffectPackageIds = new Set(
      items.map((item) => buildEffectPackageId(effectType, item.id, item.package_version)),
    )

    for (const [effectPackageId, state] of this.packageStates.entries()) {
      if (state.effectType !== effectType || activeEffectPackageIds.has(effectPackageId)) {
        continue
      }
      if (state.status === 'remote' || state.status === 'missing') {
        this.packageStates.delete(effectPackageId)
      }
    }

    for (const item of items) {
      const identity = this.createIdentity(effectType, item.id, item.package_version, catalogVersion)
      const previous = this.packageStates.get(identity.effectPackageId)
      const displayMeta = this.createMetaFromCatalogItem(
        identity,
        item,
        previous?.meta?.installedAt ?? '',
      )
      if (!previous) {
        this.setState(identity, {
          status: 'remote',
          phase: 'idle',
          progress: 0,
          meta: displayMeta,
        })
        continue
      }

      this.setState(identity, {
        catalogVersion,
        meta: {
          ...displayMeta,
          installedAt: previous.meta?.installedAt || displayMeta.installedAt,
        },
      })
    }
  }

  private async loadInstalledPackage(identity: EffectPackageIdentity, packagePath: string): Promise<void> {
    this.setState(identity, {
      status: 'loading',
      phase: 'validating',
      progress: normalizeProgress('validating'),
      packagePath,
      errorMessage: undefined,
    })

    const packageDirExists = await fileSystemService.directoryExists(packagePath).catch(() => false)
    if (!packageDirExists) {
      const resolvedIdentity = await this.resolveInstallIdentity(identity)
      if (!resolvedIdentity) {
        this.setState(identity, {
          status: 'missing',
          phase: 'error',
          progress: 0,
          packagePath,
          errorMessage: '本地效果包不存在，且远端目录中找不到对应版本',
        })
        await this.persistIndexFile()
        return
      }

      await this.installTemplate(
        resolvedIdentity.effectType,
        resolvedIdentity.templateId,
        resolvedIdentity.packageVersion,
        resolvedIdentity.catalogVersion,
      )
      return
    }

    const loaded = await effectPackageRegistry.loadCommonPackageDirectory(
      packagePath,
      identity.effectPackageId,
    )
    if (!loaded) {
      this.setState(identity, {
        status: 'error',
        phase: 'error',
        progress: 0,
        packagePath,
        errorMessage: '本地效果包校验失败',
      })
      await this.persistIndexFile()
      throw new Error(`本地效果包校验失败: ${identity.effectPackageId}`)
    }

    this.setState(identity, {
      status: 'ready',
      phase: 'ready',
      progress: normalizeProgress('ready'),
      packagePath,
      errorMessage: undefined,
    })
    await this.persistIndexFile()
  }
}

export const effectTemplateRegistry = new EffectTemplateRegistry()
