import type { DrawSourceUniforms } from '@/core/webgl2/types'
import type { BlendMode } from '@/core/timelineitem/model/blendMode'
import type { RenderPass } from '@/core/webgl2/renderchain/RenderPass'
import type { RenderPassContext } from '@/core/webgl2/renderchain/RenderPassContext'
import type { ProgramManager } from '@/core/webgl2/runtime/ProgramManager'
import type { RenderTargetPool } from '@/core/webgl2/runtime/RenderTargetPool'
import type { TextureManager } from '@/core/webgl2/runtime/TextureManager'
import COMPOSITE_VERTEX_SHADER from '@/core/webgl2/shaders/composite.vert?raw'
import COMPOSITE_NORMAL_FRAGMENT_SHADER from '@/core/webgl2/shaders/composite-normal.frag?raw'
import COMPOSITE_COLOR_DODGE_FRAGMENT_SHADER from '@/core/webgl2/shaders/composite-color-dodge.frag?raw'
import COMPOSITE_LINEAR_BURN_FRAGMENT_SHADER from '@/core/webgl2/shaders/composite-linear-burn.frag?raw'
import COMPOSITE_HARD_LIGHT_FRAGMENT_SHADER from '@/core/webgl2/shaders/composite-hard-light.frag?raw'
import COMPOSITE_MULTIPLY_FRAGMENT_SHADER from '@/core/webgl2/shaders/composite-multiply.frag?raw'
import COMPOSITE_COLOR_BURN_FRAGMENT_SHADER from '@/core/webgl2/shaders/composite-color-burn.frag?raw'
import COMPOSITE_OVERLAY_FRAGMENT_SHADER from '@/core/webgl2/shaders/composite-overlay.frag?raw'
import COMPOSITE_LIGHTEN_FRAGMENT_SHADER from '@/core/webgl2/shaders/composite-lighten.frag?raw'
import COMPOSITE_DARKEN_FRAGMENT_SHADER from '@/core/webgl2/shaders/composite-darken.frag?raw'
import COMPOSITE_SOFT_LIGHT_FRAGMENT_SHADER from '@/core/webgl2/shaders/composite-soft-light.frag?raw'
import COMPOSITE_SCREEN_FRAGMENT_SHADER from '@/core/webgl2/shaders/composite-screen.frag?raw'

const COMPOSITE_FRAGMENT_SHADERS: Record<BlendMode, string> = {
  normal: COMPOSITE_NORMAL_FRAGMENT_SHADER,
  'color-dodge': COMPOSITE_COLOR_DODGE_FRAGMENT_SHADER,
  'linear-burn': COMPOSITE_LINEAR_BURN_FRAGMENT_SHADER,
  'hard-light': COMPOSITE_HARD_LIGHT_FRAGMENT_SHADER,
  multiply: COMPOSITE_MULTIPLY_FRAGMENT_SHADER,
  'color-burn': COMPOSITE_COLOR_BURN_FRAGMENT_SHADER,
  overlay: COMPOSITE_OVERLAY_FRAGMENT_SHADER,
  lighten: COMPOSITE_LIGHTEN_FRAGMENT_SHADER,
  darken: COMPOSITE_DARKEN_FRAGMENT_SHADER,
  'soft-light': COMPOSITE_SOFT_LIGHT_FRAGMENT_SHADER,
  screen: COMPOSITE_SCREEN_FRAGMENT_SHADER,
}

export class CompositeToRenderTargetPass implements RenderPass {
  readonly id: string
  private readonly program: WebGLProgram
  private readonly blankBaseTextureId: string

  constructor(
    programs: Pick<ProgramManager, 'createProgram'>,
    private readonly texturesManager: Pick<TextureManager, 'remove'>,
    private readonly targets: Pick<RenderTargetPool, 'releaseRenderTarget'>,
    id: string,
    private readonly overlayTextureId: string,
    private readonly outputTextureId: string,
    blendMode: BlendMode,
    private readonly getUniforms: () => DrawSourceUniforms,
  ) {
    this.id = id
    this.blankBaseTextureId = `blank:${outputTextureId}`
    this.program = programs.createProgram(
      COMPOSITE_VERTEX_SHADER,
      COMPOSITE_FRAGMENT_SHADERS[blendMode],
    )
  }

  render(ctx: RenderPassContext): void {
    const overlay = ctx.textures.get(this.overlayTextureId)
    if (!overlay) {
      this.targets.releaseRenderTarget(this.outputTextureId)
      return
    }

    const outputTarget = ctx.targets.ensureRenderTarget(
      this.outputTextureId,
      ctx.canvasWidth,
      ctx.canvasHeight,
    )
    ctx.textures.ensureTexture(this.blankBaseTextureId, ctx.canvasWidth, ctx.canvasHeight)
    const blankBase = ctx.textures.get(this.blankBaseTextureId)
    if (!blankBase) {
      return
    }

    const gl = ctx.gl
    const uniforms = this.getUniforms()

    gl.bindFramebuffer(gl.FRAMEBUFFER, outputTarget.framebuffer)
    gl.viewport(0, 0, outputTarget.width, outputTarget.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this.program)
    ctx.runtime.bindUnitQuad(this.program)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, blankBase.texture)
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_main'), 0)

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, overlay.texture)
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_overlay'), 1)
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_resolution'), ctx.canvasWidth, ctx.canvasHeight)
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_translation'), uniforms.x, uniforms.y)
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_scale'), overlay.width, overlay.height)
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_rotation'), uniforms.rotationRadians)
    gl.uniform1f(
      gl.getUniformLocation(this.program, 'u_blendIntensity'),
      uniforms.blendIntensity,
    )
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  dispose(): void {
    this.targets.releaseRenderTarget(this.outputTextureId)
    this.texturesManager.remove(this.blankBaseTextureId)
  }
}
