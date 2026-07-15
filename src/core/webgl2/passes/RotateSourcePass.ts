import { normalizeClockwiseRotation } from '@/core/utils/rotationTransform'
import type { RenderPass } from '@/core/webgl2/renderchain/RenderPass'
import type { RenderPassContext } from '@/core/webgl2/renderchain/RenderPassContext'
import type { ProgramManager } from '@/core/webgl2/runtime/ProgramManager'
import type { RenderTargetPool } from '@/core/webgl2/runtime/RenderTargetPool'
import CLOCKWISE_ROTATION_SOURCE_FRAGMENT_SHADER from '@/core/webgl2/shaders/clockwiseRotation-source.frag?raw'
import CLOCKWISE_ROTATION_SOURCE_VERTEX_SHADER from '@/core/webgl2/shaders/clockwiseRotation-source.vert?raw'

/**
 * 先按媒体自身的顺时针朝向把 source texture 旋正。
 *
 * 这个 pass 只处理素材元数据里的旋转，不处理 item 自身的平移/缩放/用户旋转。
 * 输出是一个新的中间 texture，后续仍由 DrawSourcePass 负责 item 级变换。
 */
export class RotateSourcePass implements RenderPass {
  readonly id: string
  private readonly program: WebGLProgram
  private readonly normalizedClockwiseRotation: number

  constructor(
    id: string,
    programs: Pick<ProgramManager, 'createProgram'>,
    private readonly outputTextureId: string,
    private readonly targets: Pick<RenderTargetPool, 'releaseRenderTarget'>,
    private readonly getSourceTextureId: () => string | null,
    clockwiseRotation: number,
  ) {
    this.id = id
    this.normalizedClockwiseRotation = normalizeClockwiseRotation(clockwiseRotation)
    this.program = programs.createProgram(
      CLOCKWISE_ROTATION_SOURCE_VERTEX_SHADER,
      CLOCKWISE_ROTATION_SOURCE_FRAGMENT_SHADER,
    )
  }

  render(ctx: RenderPassContext): void {
    const sourceTextureId = this.getSourceTextureId()
    if (!sourceTextureId) {
      return
    }

    const source = ctx.textures.get(sourceTextureId)
    if (!source) {
      return
    }

    const shouldSwapDimensions =
      this.normalizedClockwiseRotation === 90 || this.normalizedClockwiseRotation === 270
    const outputWidth = shouldSwapDimensions ? source.height : source.width
    const outputHeight = shouldSwapDimensions ? source.width : source.height
    const outputTarget = ctx.targets.ensureRenderTarget(
      this.outputTextureId,
      outputWidth,
      outputHeight,
    )
    const gl = ctx.gl

    gl.bindFramebuffer(gl.FRAMEBUFFER, outputTarget.framebuffer)
    gl.viewport(0, 0, outputWidth, outputHeight)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this.program)
    ctx.runtime.bindUnitQuad(this.program)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, source.texture)
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_source'), 0)
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_resolution'), outputWidth, outputHeight)
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_scale'), source.width, source.height)
    gl.uniform1i(
      gl.getUniformLocation(this.program, 'u_rotation'),
      this.normalizedClockwiseRotation,
    )
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  dispose(): void {
    this.targets.releaseRenderTarget(this.outputTextureId)
  }
}
