import { normalizePackageResourcePath } from '@/core/effect-package/manifest'
import { loadSampledResource } from '@/core/effect-package/runtime/sampledResourceLoader'
import { DrawPass } from '@/core/effect-package/script/DrawPass'
import { ScriptRenderPass } from '@/core/effect-package/runtime/ScriptRenderPass'
import type { EffectPackageLut3DResourceInfo, LoadedEffectPackage } from '@/core/effect-package/types'
import { fileSystemService } from '@/core/managers/filesystem/fileSystemService'
import type { RenderPassContext } from '@/core/webgl2/renderchain/RenderPassContext'

interface ScriptEffectLifecycle {
  init(ctx: { params: Record<string, unknown> }): void
  update(ctx: {
    // 当前 pass 的 effect 评估帧，不保证等于全局播放帧。
    frame: number
    params: Record<string, unknown>
    // time 与 frame 保持一致，表示当前 pass 的 effect 评估时间。
    values: { progress: number; canvasSize: [number, number]; time: number }
  }): void
  dispose?(): void
}

interface ScriptCompileFactory {
  (
    gEffect: { addPass(pass: DrawPass): void; requestRebuild(reason?: string): void },
    gDrawPass: typeof DrawPass,
    gResources: {
      text(path: string): string
      texture(path: string): string
      lut3d(path: string): EffectPackageLut3DResourceInfo
    },
  ): () => ScriptEffectLifecycle
}

const COMPILED_FACTORY_CACHE = new Map<string, ScriptCompileFactory>()

class PendingEffectPackageResourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PendingEffectPackageResourceError'
  }
}

export interface ScriptEffectRenderState {
  params: Record<string, unknown>
  progress: number
  // 当前 pass 的 effect 评估帧，不保证等于全局播放帧。
  frame: number
  canvasSize: [number, number]
  finalOutputTextureId: string
  inputTextures: Record<string, string | null>
  passOutputTextureId: (name: string) => string
}

export class ScriptEffectController {
  private lifecycle: ScriptEffectLifecycle | null = null
  private livePasses: { drawPass: DrawPass; renderPass: ScriptRenderPass }[] = []
  private rebuildRequested = false
  private failed = false

  constructor(private readonly loadedPackage: LoadedEffectPackage) {}

  render(ctx: RenderPassContext, state: ScriptEffectRenderState): void {
    if (this.failed) {
      return
    }

    try {
      if (!this.lifecycle || this.rebuildRequested) {
        this.rebuild(ctx, state.params)
      }

      if (!this.lifecycle) {
        return
      }

      this.lifecycle.update({
        frame: state.frame,
        params: state.params,
        values: {
          progress: state.progress,
          canvasSize: state.canvasSize,
          time: state.frame / 30,
        },
      })

      for (const entry of this.livePasses) {
        entry.renderPass.render(ctx, {
          outputSize: state.canvasSize,
          finalOutputTextureId: state.finalOutputTextureId,
          passOutputTextureId: state.passOutputTextureId,
          resolveInputTexture: (textureRef) => {
            if (textureRef.startsWith('resource:')) {
              const resourcePath = normalizePackageResourcePath(textureRef.slice('resource:'.length))
              return `effectpkg-resource:${this.loadedPackage.effectPackageId}:${resourcePath}`
            }

            if (textureRef.startsWith('pass:')) {
              return state.passOutputTextureId(textureRef)
            }

            return state.inputTextures[textureRef] ?? null
          },
        })
      }
    } catch (error) {
      if (error instanceof PendingEffectPackageResourceError) {
        return
      }
      console.error(`[ScriptEffectController] 渲染 effect package 失败: ${this.loadedPackage.effectPackageId}`, error)
      this.failed = true
      this.dispose(ctx.gl)
    }
  }

  dispose(gl: WebGL2RenderingContext): void {
    for (const entry of this.livePasses) {
      entry.renderPass.dispose(gl)
    }
    this.livePasses = []
    this.lifecycle?.dispose?.()
    this.lifecycle = null
    this.rebuildRequested = false
  }

  private rebuild(ctx: RenderPassContext, params: Record<string, unknown>): void {
    this.dispose(ctx.gl)
    this.rebuildRequested = false
    const drawPasses: DrawPass[] = []

    const createEffect = this.getOrCompileFactory()(
      {
        addPass: (pass) => {
          if (drawPasses.some((entry) => entry.id === pass.id)) {
            throw new Error(`effect.addPass 重复 pass id: ${pass.id}`)
          }
          drawPasses.push(pass)
        },
        requestRebuild: () => {
          this.rebuildRequested = true
        },
      },
      DrawPass,
      {
        text: (path) => {
          const normalized = normalizePackageResourcePath(path)
          const resource = this.loadedPackage.textResources.get(normalized)
          if (resource !== undefined) {
            return resource
          }

          if (!this.loadedPackage.textResourcePaths.has(normalized)) {
            throw new Error(`effect package 文本资源不存在: ${normalized}`)
          }

          void this.loadTextResource(normalized)
          throw new PendingEffectPackageResourceError(`effect package 文本资源加载中: ${normalized}`)
        },
        texture: (path) => {
          const normalized = normalizePackageResourcePath(path)
          const descriptor = this.loadedPackage.sampledResourceDescriptors.get(normalized)
          const cached = this.loadedPackage.sampledResources.get(normalized)
          if (!descriptor && !cached) {
            throw new Error(`effect package 纹理资源不存在: ${normalized}`)
          }

          const dimension = descriptor?.dimension ?? (cached?.kind === 'lut-3d' ? '3d' : '2d')
          if (dimension !== '2d') {
            throw new Error(`effect package 纹理资源不是 2D 采样资源: ${normalized}`)
          }

          return `resource:${normalized}`
        },
        lut3d: (path) => {
          const normalized = normalizePackageResourcePath(path)
          const cached = this.loadedPackage.sampledResources.get(normalized)
          if (cached?.kind === 'lut-3d') {
            return {
              textureRef: `resource:${normalized}`,
              size: cached.size,
              domainMin: [...cached.domainMin] as [number, number, number],
              domainMax: [...cached.domainMax] as [number, number, number],
            }
          }

          const descriptor = this.loadedPackage.sampledResourceDescriptors.get(normalized)
          if (!descriptor) {
            throw new Error(`effect package 3D LUT 资源不存在: ${normalized}`)
          }
          if (descriptor.dimension !== '3d' || descriptor.resourceType !== 'lut-3d') {
            throw new Error(`effect package 资源不是 3D LUT: ${normalized}`)
          }

          void this.loadLut3DResource(normalized)
          throw new PendingEffectPackageResourceError(`effect package 3D LUT 资源加载中: ${normalized}`)
        },
      },
    )()

    createEffect.init({ params })
    const livePasses = drawPasses.map((drawPass) => {
      drawPass.enterUpdatePhase()
      return {
        drawPass,
        renderPass: new ScriptRenderPass(this.loadedPackage, drawPass),
      }
    })
    this.lifecycle = createEffect
    this.livePasses = livePasses
  }

  private getOrCompileFactory(): ScriptCompileFactory {
    const cacheKey = `${this.loadedPackage.payload.packageId}:${this.loadedPackage.payload.version}:${this.loadedPackage.payload.scriptHash}`
    const existing = COMPILED_FACTORY_CACHE.get(cacheKey)
    if (existing) {
      return existing
    }

    const compiled = new Function(
      'gEffect',
      'gDrawPass',
      'gResources',
      `"use strict"; ${this.loadedPackage.entrySource}; return createEffect;`,
    ) as ScriptCompileFactory
    COMPILED_FACTORY_CACHE.set(cacheKey, compiled)
    return compiled
  }

  private async loadTextResource(resourcePath: string): Promise<string | null> {
    const cached = this.loadedPackage.textResources.get(resourcePath)
    if (cached !== undefined) {
      return cached
    }

    const existing = this.loadedPackage.pendingTextLoads.get(resourcePath)
    if (existing) {
      return existing.catch(() => null)
    }

    const absolutePath = this.loadedPackage.textResourcePaths.get(resourcePath)
    if (!absolutePath) {
      return null
    }

    const pending = fileSystemService.readFile(absolutePath)
      .then((content) => {
        this.loadedPackage.textResources.set(resourcePath, content)
        this.loadedPackage.pendingTextLoads.delete(resourcePath)
        this.rebuildRequested = true
        return content
      })
      .catch((error) => {
        this.loadedPackage.pendingTextLoads.delete(resourcePath)
        console.error(`[ScriptEffectController] 加载文本资源失败: ${resourcePath}`, error)
        throw error
      })

    this.loadedPackage.pendingTextLoads.set(resourcePath, pending)
    return pending.catch(() => null)
  }

  private async loadLut3DResource(resourcePath: string): Promise<EffectPackageLut3DResourceInfo | null> {
    const cached = this.loadedPackage.sampledResources.get(resourcePath)
    if (cached?.kind === 'lut-3d') {
      return {
        textureRef: `resource:${resourcePath}`,
        size: cached.size,
        domainMin: [...cached.domainMin] as [number, number, number],
        domainMax: [...cached.domainMax] as [number, number, number],
      }
    }

    const resource = await loadSampledResource(this.loadedPackage, resourcePath)
      .then((loaded) => {
        if (loaded?.kind === 'lut-3d') {
          this.rebuildRequested = true
          return loaded
        }

        if (loaded) {
          throw new Error(`effect package 资源不是 3D LUT: ${resourcePath}`)
        }

        return null
      })
      .catch((error) => {
        console.error(`[ScriptEffectController] 加载 3D LUT 资源失败: ${resourcePath}`, error)
        return null
      })

    if (!resource) {
      return null
    }

    return {
      textureRef: `resource:${resourcePath}`,
      size: resource.size,
      domainMin: [...resource.domainMin] as [number, number, number],
      domainMax: [...resource.domainMax] as [number, number, number],
    }
  }
}
