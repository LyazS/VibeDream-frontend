import { fileToImageBitmap } from '@/core/bunnyUtils/ToBitmap'
import { parseCubeLut } from '@/core/effect-package/runtime/cubeLut'
import type {
  LoadedEffectImageResource,
  LoadedEffectLut3DResource,
  LoadedEffectPackage,
  LoadedEffectPackageSampledResource,
} from '@/core/effect-package/types'
import { fileSystemService } from '@/core/managers/filesystem/fileSystemService'

export function disposeLoadedSampledResource(resource: LoadedEffectPackageSampledResource): void {
  if (resource.kind === 'image-2d') {
    resource.bitmap.close()
  }
}

async function loadImageResource(absolutePath: string): Promise<LoadedEffectImageResource> {
  const blob = await fileSystemService.readFileAsBlob(absolutePath)
  const fileName = absolutePath.slice(absolutePath.lastIndexOf('/') + 1)
  const bitmap = await fileToImageBitmap(
    new File([blob], fileName, { type: blob.type || 'application/octet-stream' }),
  )
  return {
    kind: 'image-2d',
    bitmap,
  }
}

async function loadLut3DResource(absolutePath: string): Promise<LoadedEffectLut3DResource> {
  const source = await fileSystemService.readFile(absolutePath)
  return {
    kind: 'lut-3d',
    ...parseCubeLut(source),
  }
}

export async function loadSampledResource(
  loadedPackage: LoadedEffectPackage,
  resourcePath: string,
): Promise<LoadedEffectPackageSampledResource | null> {
  const cached = loadedPackage.sampledResources.get(resourcePath)
  if (cached) {
    return cached
  }

  const existing = loadedPackage.pendingSampledResourceLoads.get(resourcePath)
  if (existing) {
    return existing.catch(() => null)
  }

  const descriptor = loadedPackage.sampledResourceDescriptors.get(resourcePath)
  if (!descriptor) {
    return null
  }

  const pending = (async () => {
    const resource = descriptor.resourceType === 'lut-3d'
      ? await loadLut3DResource(descriptor.absolutePath)
      : await loadImageResource(descriptor.absolutePath)
    loadedPackage.sampledResources.set(resourcePath, resource)
    loadedPackage.pendingSampledResourceLoads.delete(resourcePath)
    return resource
  })().catch((error) => {
    loadedPackage.pendingSampledResourceLoads.delete(resourcePath)
    throw error
  })

  loadedPackage.pendingSampledResourceLoads.set(resourcePath, pending)
  return pending.catch(() => null)
}
