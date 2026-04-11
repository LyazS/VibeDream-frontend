import { ScriptEffectController } from '@/core/effect-package/runtime/ScriptEffectController'
import type { LoadedEffectPackage } from '@/core/effect-package/types'
import type { RenderPass } from '@/core/webgl2/renderchain/RenderPass'
import type { RenderPassContext } from '@/core/webgl2/renderchain/RenderPassContext'
import type { ProgramManager } from '@/core/webgl2/runtime/ProgramManager'
import type { RenderTargetPool } from '@/core/webgl2/runtime/RenderTargetPool'
import FILTER_BLEND_FRAGMENT_SHADER from '@/core/webgl2/shaders/filter-blend.frag?raw'
import FULLSCREEN_VERTEX_SHADER from '@/core/webgl2/shaders/fullscreen.vert?raw'

export class EffectPackageFilterPass implements RenderPass {
  readonly id: string
  private readonly controller: ScriptEffectController
  private readonly blendProgram: WebGLProgram
  private readonly filteredOutputTextureId: string
  private lastGl: WebGL2RenderingContext | null = null

  constructor(
    programs: Pick<ProgramManager, 'createProgram'>,
    private readonly targets: Pick<RenderTargetPool, 'releaseRenderTarget' | 'ensureRenderTarget'>,
    id: string,
    loadedPackage: LoadedEffectPackage,
    private readonly finalOutputTextureId: string,
    private readonly getEvaluationFrame: () => number,
    private readonly getIntensity: () => number,
    private readonly getParams: () => Record<string, unknown>,
    private readonly getInputTextureId: () => string | null,
    private readonly getPassTextureId: (name: string) => string,
  ) {
    this.id = id
    this.controller = new ScriptEffectController(loadedPackage)
    this.blendProgram = programs.createProgram(FULLSCREEN_VERTEX_SHADER, FILTER_BLEND_FRAGMENT_SHADER)
    this.filteredOutputTextureId = `${id}:filtered`
  }

  render(ctx: RenderPassContext): void {
    this.lastGl = ctx.gl
    const sourceTextureId = this.getInputTextureId()
    if (!sourceTextureId) {
      return
    }

    this.controller.render(ctx, {
      params: this.getParams(),
      progress: 0,
      frame: this.getEvaluationFrame(),
      finalOutputTextureId: this.filteredOutputTextureId,
      inputTextures: {
        'input:source': sourceTextureId,
      },
      passOutputTextureId: this.getPassTextureId,
    })

    const sourceTexture = ctx.textures.get(sourceTextureId)
    const filteredTexture = ctx.textures.get(this.filteredOutputTextureId) ?? sourceTexture
    if (!sourceTexture || !filteredTexture) {
      return
    }

    const gl = ctx.gl
    const outputTarget = ctx.targets.ensureRenderTarget(
      this.finalOutputTextureId,
      ctx.canvasWidth,
      ctx.canvasHeight,
    )

    gl.bindFramebuffer(gl.FRAMEBUFFER, outputTarget.framebuffer)
    gl.viewport(0, 0, outputTarget.width, outputTarget.height)
    gl.useProgram(this.blendProgram)
    ctx.runtime.bindFullscreenQuad(this.blendProgram)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture.texture)
    gl.uniform1i(gl.getUniformLocation(this.blendProgram, 'u_source'), 0)

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, filteredTexture.texture)
    gl.uniform1i(gl.getUniformLocation(this.blendProgram, 'u_filtered'), 1)
    gl.uniform1f(gl.getUniformLocation(this.blendProgram, 'u_intensity'), this.getIntensity())
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  dispose(): void {
    if (this.lastGl) {
      this.controller.dispose(this.lastGl)
      this.lastGl = null
    }
    this.targets.releaseRenderTarget(this.filteredOutputTextureId)
  }
}
