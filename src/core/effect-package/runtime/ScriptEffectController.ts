import { normalizePackageResourcePath } from '@/core/effect-package/manifest'
import { DrawPass } from '@/core/effect-package/script/DrawPass'
import { ScriptRenderPass } from '@/core/effect-package/runtime/ScriptRenderPass'
import type { LoadedEffectPackage } from '@/core/effect-package/types'
import { fileSystemService } from '@/core/managers/filesystem/fileSystemService'
import type { RenderPassContext } from '@/core/webgl2/renderchain/RenderPassContext'

interface ScriptEffectLifecycle {
  init(ctx: { params: Record<string, unknown> }): void
  update(ctx: {
    frame: number
    params: Record<string, unknown>
    values: { progress: number; canvasSize: [number, number]; time: number }
  }): void
  dispose?(): void
}

interface ScriptCompileFactory {
  (
    gEffect: { addPass(pass: DrawPass): void; requestRebuild(reason?: string): void },
    gDrawPass: typeof DrawPass,
    gResources: { text(path: string): string; texture(path: string): string },
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
  frame: number
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
          canvasSize: [ctx.canvasWidth, ctx.canvasHeight],
          time: state.frame / 30,
        },
      })

      for (const entry of this.livePasses) {
        entry.renderPass.render(ctx, {
          finalOutputTextureId: state.finalOutputTextureId,
          passOutputTextureId: state.passOutputTextureId,
          resolveInputTexture: (textureRef) => {
            if (textureRef.startsWith('resource:')) {
              const resourcePath = normalizePackageResourcePath(textureRef.slice('resource:'.length))
              return `effectpkg-resource:${this.loadedPackage.assetId}:${resourcePath}`
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
      console.error(`[ScriptEffectController] 渲染 effect package 失败: ${this.loadedPackage.assetId}`, error)
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
          if (
            !this.loadedPackage.textureResourcePaths.has(normalized) &&
            !this.loadedPackage.textureResources.has(normalized)
          ) {
            throw new Error(`effect package 纹理资源不存在: ${normalized}`)
          }
          return `resource:${normalized}`
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
}
