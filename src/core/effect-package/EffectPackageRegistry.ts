import {
  createEffectTemplateSourceDataFromTemplate,
  createFilterTemplateAssetData,
  createTransitionTemplateAssetData,
  type EffectTemplateAssetData,
} from '@/core/asset/types'
import type { EffectTemplatePackageFile } from '@/core/effect-template/catalogTypes'
import { fileSystemService } from '@/core/managers/filesystem/fileSystemService'
import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'
import { SourceOrigin } from '@/core/datasource/core/BaseDataSource'
import {
  buildFilterPackagePayload,
  buildTransitionPackagePayload,
  hashString,
  normalizeManifest,
  normalizePackageResourcePath,
} from '@/core/effect-package/manifest'
import type {
  EffectPackageSampledResourceDescriptor,
  LoadedEffectPackageSampledResource,
  LoadedEffectPackage,
} from '@/core/effect-package/types'
import { disposeLoadedSampledResource } from '@/core/effect-package/runtime/sampledResourceLoader'

const TEXT_EXTENSIONS = new Set(['.js', '.json', '.vert', '.frag', '.glsl', '.txt', '.wgsl'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'])
const LUT_3D_EXTENSIONS = new Set(['.cube'])

function extname(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(dot).toLowerCase()
}

function stripLeading(path: string, prefix: string): string {
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}

export class EffectPackageRegistry {
  private readonly packages = new Map<string, LoadedEffectPackage>()

  getPackage(assetId: string): LoadedEffectPackage | null {
    return this.packages.get(assetId) ?? null
  }

  removePackage(assetId: string): void {
    const entry = this.packages.get(assetId)
    if (!entry) {
      return
    }

    for (const resource of entry.sampledResources.values()) {
      disposeLoadedSampledResource(resource)
    }
    this.packages.delete(assetId)
  }

  clear(): void {
    for (const entry of this.packages.values()) {
      for (const resource of entry.sampledResources.values()) {
        disposeLoadedSampledResource(resource)
      }
    }
    this.packages.clear()
  }

  async discoverProjectPackages(projectId: string): Promise<EffectTemplateAssetData[]> {
    const mediaDirPath = fileSystemService.paths.getMediaDirPath(projectId)
    const mediaDirExists = await fileSystemService.directoryExists(mediaDirPath)
    if (!mediaDirExists) {
      this.clear()
      return []
    }

    const entries = await fileSystemService.listDirectory(mediaDirPath)
    const packageDirectories: Array<{ path: string; assetId: string }> = []
    for (const entry of entries) {
      if (entry.kind !== 'directory') {
        continue
      }

      const manifestPath = `${entry.path}/manifest.json`
      const hasManifest = await fileSystemService.fileExists(manifestPath).catch(() => false)
      if (!hasManifest) {
        continue
      }

      packageDirectories.push({
        path: entry.path,
        assetId: entry.name.replace(/\.effectpkg$/, ''),
      })
    }

    const discovered = await Promise.all(
      packageDirectories.map((entry) => this.loadPackageDirectory(entry.path, entry.assetId)),
    )

    const packages = discovered.filter((entry): entry is { asset: EffectTemplateAssetData; loaded: LoadedEffectPackage } => Boolean(entry))
    this.clear()

    for (const entry of packages) {
      this.packages.set(entry.asset.id, entry.loaded)
    }

    return packages.map((entry) => entry.asset)
  }

  async installDownloadedPackage(
    projectId: string,
    assetId: string,
    packageFiles: EffectTemplatePackageFile[],
  ): Promise<EffectTemplateAssetData> {
    const mediaDirPath = fileSystemService.paths.getMediaDirPath(projectId)
    const mediaDirExists = await fileSystemService.directoryExists(mediaDirPath)
    if (!mediaDirExists) {
      await fileSystemService.createDirectory(mediaDirPath)
    }

    const packageDirPath = fileSystemService.paths.getMediaPath(projectId, assetId)
    const existingPackageDir = await fileSystemService.directoryExists(packageDirPath).catch(() => false)
    if (existingPackageDir) {
      await fileSystemService.deleteDirectory(packageDirPath, true)
    }
    await fileSystemService.createDirectory(packageDirPath)

    for (const file of packageFiles) {
      const targetPath = `${packageDirPath}/${normalizePackageResourcePath(file.path)}`
      await this.ensureParentDirectory(targetPath)
      if (file.encoding === 'base64') {
        const bytes = Uint8Array.from(atob(file.content), (char) => char.charCodeAt(0))
        await fileSystemService.writeFile(targetPath, new Blob([bytes]))
      } else {
        await fileSystemService.writeFile(targetPath, file.content)
      }
    }

    const loaded = await this.loadPackageDirectory(packageDirPath, assetId)
    if (!loaded) {
      throw new Error(`下载的 effect package 无法加载: ${assetId}`)
    }

    this.removePackage(assetId)
    this.packages.set(assetId, loaded.loaded)
    await globalMetaFileManager.saveMetaFile(loaded.asset)
    return loaded.asset
  }

  async cleanupInstalledPackage(projectId: string, assetId: string): Promise<void> {
    this.removePackage(assetId)

    const packageDirPath = fileSystemService.paths.getMediaPath(projectId, assetId)
    const packageDirExists = await fileSystemService.directoryExists(packageDirPath).catch(() => false)
    if (packageDirExists) {
      await fileSystemService.deleteDirectory(packageDirPath, true)
    }
  }

  private async loadPackageDirectory(
    directoryPath: string,
    assetId: string,
  ): Promise<{ asset: EffectTemplateAssetData; loaded: LoadedEffectPackage } | null> {
    try {
      const manifestPath = `${directoryPath}/manifest.json`
      const manifestSource = await fileSystemService.readFile(manifestPath)
      const manifest = normalizeManifest(JSON.parse(manifestSource))
      if (!manifest.is_active) {
        return null
      }

      const entrySource = await fileSystemService.readFile(`${directoryPath}/${manifest.entry}`)
      const files = await this.collectFiles(directoryPath)
      const textResourcePaths = new Map<string, string>()
      const textResources = new Map<string, string>([[manifest.entry, entrySource]])
      const sampledResourceDescriptors = new Map<string, EffectPackageSampledResourceDescriptor>()

      for (const filePath of files) {
        const normalized = normalizePackageResourcePath(stripLeading(filePath, `${directoryPath}/`))
        const extension = extname(filePath)
        if (TEXT_EXTENSIONS.has(extension)) {
          textResourcePaths.set(normalized, filePath)
          continue
        }

        if (IMAGE_EXTENSIONS.has(extension)) {
          sampledResourceDescriptors.set(normalized, {
            absolutePath: filePath,
            dimension: '2d',
            resourceType: 'image-2d',
          })
          continue
        }

        if (LUT_3D_EXTENSIONS.has(extension)) {
          sampledResourceDescriptors.set(normalized, {
            absolutePath: filePath,
            dimension: '3d',
            resourceType: 'lut-3d',
          })
        }
      }

      const scriptHash = hashString(entrySource)
      let payload
      let asset: EffectTemplateAssetData
      if (manifest.effectType === 'transition') {
        payload = buildTransitionPackagePayload(directoryPath, manifest, scriptHash)
        asset = createTransitionTemplateAssetData(assetId, manifest.name.zh || manifest.name.en, payload, {
          source: createEffectTemplateSourceDataFromTemplate(
            manifest.packageId,
            undefined,
            SourceOrigin.PROJECT_LOAD,
          ),
          templateStatus: 'ready',
        })
      } else {
        payload = buildFilterPackagePayload(directoryPath, manifest, scriptHash)
        asset = createFilterTemplateAssetData(assetId, manifest.name.zh || manifest.name.en, payload, {
          source: createEffectTemplateSourceDataFromTemplate(
            manifest.packageId,
            undefined,
            SourceOrigin.PROJECT_LOAD,
          ),
          templateStatus: 'ready',
        })
      }

      return {
        asset,
        loaded: {
          assetId,
          packageDir: directoryPath,
          manifest,
          entrySource,
          textResourcePaths,
          textResources,
          pendingTextLoads: new Map<string, Promise<string>>(),
          sampledResourceDescriptors,
          sampledResources: new Map<string, LoadedEffectPackageSampledResource>(),
          pendingSampledResourceLoads: new Map<string, Promise<LoadedEffectPackageSampledResource>>(),
          payload,
        },
      }
    } catch (error) {
      console.error(`[EffectPackageRegistry] 加载 effect package 失败: ${directoryPath}`, error)
      return null
    }
  }

  private async collectFiles(directoryPath: string): Promise<string[]> {
    const entries = await fileSystemService.listDirectory(directoryPath)
    const files: string[] = []

    for (const entry of entries) {
      if (entry.kind === 'file') {
        files.push(entry.path)
        continue
      }

      if (entry.kind === 'directory') {
        files.push(...(await this.collectFiles(entry.path)))
      }
    }

    return files
  }

  private async ensureParentDirectory(filePath: string): Promise<void> {
    const slash = filePath.lastIndexOf('/')
    if (slash <= 0) {
      return
    }

    await fileSystemService.createDirectory(filePath.slice(0, slash))
  }
}

export const effectPackageRegistry = new EffectPackageRegistry()
