import type { EffectTemplatePackageFile } from '@/core/effect-template/catalogTypes'
import { fileSystemService } from '@/core/managers/filesystem/fileSystemService'
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

  getPackage(effectPackageId: string): LoadedEffectPackage | null {
    return this.packages.get(effectPackageId) ?? null
  }

  removePackage(effectPackageId: string): void {
    const entry = this.packages.get(effectPackageId)
    if (!entry) {
      return
    }

    for (const resource of entry.sampledResources.values()) {
      disposeLoadedSampledResource(resource)
    }
    this.packages.delete(effectPackageId)
  }

  clear(): void {
    for (const entry of this.packages.values()) {
      for (const resource of entry.sampledResources.values()) {
        disposeLoadedSampledResource(resource)
      }
    }
    this.packages.clear()
  }

  async writePackageFiles(
    packageDirPath: string,
    packageFiles: EffectTemplatePackageFile[],
  ): Promise<void> {
    const preparedFiles = packageFiles.map((file) => {
      const targetPath = `${packageDirPath}/${normalizePackageResourcePath(file.path)}`
      if (file.encoding === 'base64') {
        const bytes = Uint8Array.from(atob(file.content), (char) => char.charCodeAt(0))
        return {
          targetPath,
          encoding: file.encoding,
          sizeBytes: bytes.byteLength,
          content: new Blob([bytes]) as string | Blob,
        }
      }

      return {
        targetPath,
        encoding: file.encoding,
        sizeBytes: new Blob([file.content]).size,
        content: file.content as string | Blob,
      }
    })
    const parentDirs = Array.from(new Set(preparedFiles.map((file) => this.getParentDirectory(file.targetPath))))

    for (const directoryPath of parentDirs) {
      if (!directoryPath) {
        continue
      }
      await fileSystemService.createDirectory(directoryPath)
    }

    await Promise.all(preparedFiles.map(async (file) => {
      await fileSystemService.writeFile(file.targetPath, file.content)
    }))
  }

  async installDownloadedPackage(
    projectId: string,
    assetId: string,
    packageFiles: EffectTemplatePackageFile[],
  ): Promise<{ name: string; templatePayload: LoadedEffectPackage['payload'] }> {
    const mediaDirPath = fileSystemService.paths.getMediaDirPath(projectId)
    if (!(await fileSystemService.directoryExists(mediaDirPath).catch(() => false))) {
      await fileSystemService.createDirectory(mediaDirPath)
    }

    const packageDirPath = fileSystemService.paths.getMediaPath(projectId, assetId)
    if (await fileSystemService.directoryExists(packageDirPath).catch(() => false)) {
      await fileSystemService.deleteDirectory(packageDirPath, true)
    }
    await fileSystemService.createDirectory(packageDirPath)
    await this.writePackageFiles(packageDirPath, packageFiles)

    const loaded = await this.loadPackageFromDirectory(packageDirPath, assetId)
    if (!loaded) {
      throw new Error(`下载的 effect package 无法加载: ${assetId}`)
    }

    return {
      name: loaded.manifest.name.zh || loaded.manifest.name.en || loaded.manifest.packageId,
      templatePayload: loaded.payload,
    }
  }

  async cleanupInstalledPackage(projectId: string, assetId: string): Promise<void> {
    this.removePackage(assetId)
    const packageDirPath = fileSystemService.paths.getMediaPath(projectId, assetId)
    if (await fileSystemService.directoryExists(packageDirPath).catch(() => false)) {
      await fileSystemService.deleteDirectory(packageDirPath, true)
    }
  }

  async loadPackageFromDirectory(
    directoryPath: string,
    effectPackageId: string,
  ): Promise<LoadedEffectPackage | null> {
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
      if (manifest.effectType === 'transition') {
        payload = buildTransitionPackagePayload(directoryPath, manifest, scriptHash)
      } else {
        payload = buildFilterPackagePayload(directoryPath, manifest, scriptHash)
      }

      const loaded: LoadedEffectPackage = {
        effectPackageId,
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
      }
      this.removePackage(effectPackageId)
      this.packages.set(effectPackageId, loaded)
      return loaded
    } catch (error) {
      console.error(`[EffectPackageRegistry] 加载 effect package 失败: ${directoryPath}`, error)
      return null
    }
  }

  async loadCommonPackageDirectory(
    directoryPath: string,
    effectPackageId: string,
  ): Promise<LoadedEffectPackage | null> {
    return this.loadPackageFromDirectory(directoryPath, effectPackageId)
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
  private getParentDirectory(filePath: string): string {
    const slash = filePath.lastIndexOf('/')
    return slash <= 0 ? '' : filePath.slice(0, slash)
  }
}

export const effectPackageRegistry = new EffectPackageRegistry()
