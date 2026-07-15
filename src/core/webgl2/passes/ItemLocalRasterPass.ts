import type { RenderPass } from '@/core/webgl2/renderchain/RenderPass'
import type { RenderPassContext } from '@/core/webgl2/renderchain/RenderPassContext'
import type { ProgramManager } from '@/core/webgl2/runtime/ProgramManager'
import type { RenderTargetPool } from '@/core/webgl2/runtime/RenderTargetPool'
import DRAW_SOURCE_FRAGMENT_SHADER from '@/core/webgl2/shaders/draw-source.frag?raw'
import DRAW_SOURCE_VERTEX_SHADER from '@/core/webgl2/shaders/draw-source.vert?raw'

interface ItemLocalSize {
  width: number
  height: number
}

/**
 * 把 source texture 栅格化到 item 当前显示尺寸的局部离屏纹理。
 *
 * 这一步之后，item 局部纹理的尺寸就等于 renderConfig.width/height，
 * 后续蒙版和其他局部效果都应在这套 item-local 空间里计算。
 */
export class ItemLocalRasterPass implements RenderPass {
  readonly id: string
  private readonly program: WebGLProgram

  constructor(
    id: string,
    programs: Pick<ProgramManager, 'createProgram'>,
    private readonly outputTextureId: string,
    private readonly targets: Pick<RenderTargetPool, 'releaseRenderTarget' | 'ensureRenderTarget'>,
    private readonly getSourceTextureId: () => string | null,
    private readonly getOutputSize: () => ItemLocalSize,
  ) {
    this.id = id
    this.program = programs.createProgram(DRAW_SOURCE_VERTEX_SHADER, DRAW_SOURCE_FRAGMENT_SHADER)
  }

  render(ctx: RenderPassContext): void {
    const sourceTextureId = this.getSourceTextureId()
    if (!sourceTextureId) return

    const source = ctx.textures.get(sourceTextureId)
    if (!source) return

    const outputSize = this.getOutputSize()
    const outputWidth = Math.max(1, Math.round(outputSize.width))
    const outputHeight = Math.max(1, Math.round(outputSize.height))
    const outputTarget = this.targets.ensureRenderTarget(
      this.outputTextureId,
      outputWidth,
      outputHeight,
    )
    const gl = ctx.gl

    gl.bindFramebuffer(gl.FRAMEBUFFER, outputTarget.framebuffer)
    gl.viewport(0, 0, outputTarget.width, outputTarget.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this.program)
    ctx.runtime.bindFullscreenQuad(this.program)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, source.texture)
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_source'), 0)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  dispose(): void {
    this.targets.releaseRenderTarget(this.outputTextureId)
  }
}
