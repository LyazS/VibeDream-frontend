import { ScriptEffectController } from '@/core/effect-package/runtime/ScriptEffectController'
import type { LoadedEffectPackage } from '@/core/effect-package/types'
import type { RenderPass } from '@/core/webgl2/renderchain/RenderPass'
import type { RenderPassContext } from '@/core/webgl2/renderchain/RenderPassContext'

export class EffectPackageTransitionPass implements RenderPass {
  readonly id: string
  private readonly controller: ScriptEffectController
  private lastGl: WebGL2RenderingContext | null = null

  constructor(
    id: string,
    loadedPackage: LoadedEffectPackage,
    private readonly finalOutputTextureId: string,
    private readonly getFrame: () => number,
    private readonly getProgress: () => number,
    private readonly getParams: () => Record<string, unknown>,
    private readonly resolveInputTextures: () => Record<string, string | null>,
    private readonly getPassTextureId: (name: string) => string,
  ) {
    this.id = id
    this.controller = new ScriptEffectController(loadedPackage)
  }

  render(ctx: RenderPassContext): void {
    this.lastGl = ctx.gl
    this.controller.render(ctx, {
      params: this.getParams(),
      progress: this.getProgress(),
      frame: this.getFrame(),
      finalOutputTextureId: this.finalOutputTextureId,
      inputTextures: this.resolveInputTextures(),
      passOutputTextureId: this.getPassTextureId,
    })
  }

  dispose(): void {
    if (this.lastGl) {
      this.controller.dispose(this.lastGl)
      this.lastGl = null
    }
  }
}
