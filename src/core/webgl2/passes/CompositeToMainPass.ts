import type { DrawSourceUniforms } from '@/core/webgl2/types'
import type { BlendMode } from '@/core/timelineitem/model/blendMode'
import type { RenderPass } from '@/core/webgl2/renderchain/RenderPass'
import type { RenderPassContext } from '@/core/webgl2/renderchain/RenderPassContext'
import type { ProgramManager } from '@/core/webgl2/runtime/ProgramManager'
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

/**
 * 把 item 局部纹理按时间轴几何配置放到主画面，并执行 alpha over。
 *
 * 每种 blend mode 使用独立 fragment shader。
 * 当 blendMode 改变时，链签名变化，TimelineRenderChainAdapter 会重建整条链。
 *
 * 时序约定：
 * - 读取主画面前先调用 `swapMainTarget()`
 * - `swapMainTarget()` 会把上一轮最新结果提升到 `read`，并预复制到 `write`
 * - 当前 pass 只负责在 `write` 上局部覆盖 overlay 区域
 */
export class CompositeToMainPass implements RenderPass {
  readonly id: string
  private readonly program: WebGLProgram

  constructor(
    programs: Pick<ProgramManager, 'createProgram'>,
    id = 'composite-to-main',
    private readonly overlayTextureId?: string,
    blendMode: BlendMode = 'normal',
    private readonly getUniforms?: () => DrawSourceUniforms,
  ) {
    this.id = id
    this.program = programs.createProgram(
      COMPOSITE_VERTEX_SHADER,
      COMPOSITE_FRAGMENT_SHADERS[blendMode],
    )
  }

  render(ctx: RenderPassContext): void {
    if (!this.overlayTextureId || !this.getUniforms) {
      return
    }

    ctx.targets.swapMainTarget()
    const mainTarget = ctx.targets.mainTarget
    const overlay = ctx.textures.get(this.overlayTextureId)
    const base = ctx.textures.get(mainTarget.read.textureId)
    if (!overlay || !base) {
      return
    }

    const gl = ctx.gl
    const uniforms = this.getUniforms()

    // `swapMainTarget()` 已先把最新底图复制到 `write`，这里只改写当前 item 覆盖到的区域。
    gl.bindFramebuffer(gl.FRAMEBUFFER, mainTarget.write.framebuffer)
    gl.viewport(0, 0, ctx.canvasWidth, ctx.canvasHeight)
    gl.useProgram(this.program)
    ctx.runtime.bindUnitQuad(this.program)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, base.texture)
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_main'), 0)

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, overlay.texture)
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_overlay'), 1)
    gl.uniform2f(
      gl.getUniformLocation(this.program, 'u_resolution'),
      ctx.canvasWidth,
      ctx.canvasHeight,
    )
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_translation'), uniforms.x, uniforms.y)
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_scale'), overlay.width, overlay.height)
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_rotation'), uniforms.rotationRadians)
    gl.uniform1f(
      gl.getUniformLocation(this.program, 'u_blendIntensity'),
      uniforms.blendIntensity,
    )

    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  dispose(): void {}
}
