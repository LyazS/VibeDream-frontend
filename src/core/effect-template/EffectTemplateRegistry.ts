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

    const response = effectType === 'transition'
      ? await transitionTemplateCatalogService.getTemplateSummaries()
      : await filterTemplateCatalogService.getTemplateSummaries()
    const catalogVersion = assertCatalogVersion(response.catalog_version)
    const catalog: CommonEffectCatalog<CatalogItemByType<T>> = {
      effectType,
      catalogVersion,
      items: response.items as CatalogItemByType<T>[],
    }

    this.catalogs.set(effectType, catalog)
    await fileSystemService.writeFile(
      fileSystemService.paths.getEffectCatalogPath(effectType),
      JSON.stringify(catalog, null, 2),
    )
    this.syncCatalogStates(effectType, catalog.items, catalogVersion)
    return catalog
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
      const reloaded = await effectPackageRegistry.loadCommonPackageDirectory(
        currentState.packagePath,
        identity.effectPackageId,
      )
      if (reloaded) {
        return
      }
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

  private async rebuildStateFromDisk(): Promise<void> {
    this.packageStates.clear()
    effectPackageRegistry.clear()

    const indexFile = await this.readIndexFile()
    if (indexFile) {
      for (const entry of indexFile.packages) {
        const identity = this.createIdentity(
          entry.effectType,
          entry.templateId,
          entry.packageVersion,
          entry.catalogVersion,
        )
        this.setState(identity, {
          status: entry.status,
          phase: entry.status === 'ready' ? 'ready' : 'error',
          progress: entry.status === 'ready' ? 100 : 0,
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
          const loaded = await effectPackageRegistry.loadCommonPackageDirectory(
            versionDir.path,
            identity.effectPackageId,
          )
          this.setState(identity, {
            status: loaded ? 'ready' : 'error',
            phase: loaded ? 'ready' : 'error',
            progress: loaded ? 100 : 0,
            packagePath: versionDir.path,
            meta: meta ?? undefined,
            errorMessage: loaded ? undefined : '本地效果包校验失败',
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
          status: entry.status === 'error' || entry.status === 'missing' ? entry.status : 'ready',
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
      packages: Array.from(this.packageStates.values()).map((state): CommonEffectIndexEntry => ({
        effectPackageId: state.effectPackageId,
        effectType: state.effectType,
        templateId: state.templateId,
        packageVersion: state.packageVersion,
        catalogVersion: state.catalogVersion,
        status: state.status === 'ready' ? 'ready' : state.status === 'missing' ? 'missing' : 'error',
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
    if (currentState?.catalogVersion) {
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
}

export const effectTemplateRegistry = new EffectTemplateRegistry()
