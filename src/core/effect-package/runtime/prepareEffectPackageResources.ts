import { loadSampledResource } from '@/core/effect-package/runtime/sampledResourceLoader'
import type { LoadedEffectPackage } from '@/core/effect-package/types'
import { fileSystemService } from '@/core/managers/filesystem/fileSystemService'

/** Single-frame renders cannot rely on later preview ticks to finish lazy resource loading. */
export async function prepareEffectPackageResources(
  loadedPackage: LoadedEffectPackage,
): Promise<void> {
  await Promise.all([
    ...Array.from(loadedPackage.textResourcePaths, async ([resourcePath, absolutePath]) => {
      if (loadedPackage.textResources.has(resourcePath)) return

      const existing = loadedPackage.pendingTextLoads.get(resourcePath)
      if (existing) {
        await existing
        return
      }

      const pending = fileSystemService.readFile(absolutePath).then((content) => {
        loadedPackage.textResources.set(resourcePath, content)
        return content
      })
      loadedPackage.pendingTextLoads.set(resourcePath, pending)
      try {
        await pending
      } finally {
        loadedPackage.pendingTextLoads.delete(resourcePath)
      }
    }),
    ...Array.from(loadedPackage.sampledResourceDescriptors.keys(), async (resourcePath) => {
      if (!(await loadSampledResource(loadedPackage, resourcePath))) {
        throw new Error(`效果包资源加载失败: ${loadedPackage.effectPackageId}/${resourcePath}`)
      }
    }),
  ])
}
