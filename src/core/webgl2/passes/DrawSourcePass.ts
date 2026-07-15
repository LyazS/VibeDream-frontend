import type { RenderPass } from '@/core/webgl2/renderchain/RenderPass'
import type { RenderPassContext } from '@/core/webgl2/renderchain/RenderPassContext'
import type { ProgramManager } from '@/core/webgl2/runtime/ProgramManager'
import type { RenderTargetPool } from '@/core/webgl2/runtime/RenderTargetPool'
import DRAW_SOURCE_FRAGMENT_SHADER from '@/core/webgl2/shaders/draw-source.frag?raw'
import DRAW_SOURCE_VERTEX_SHADER from '@/core/webgl2/shaders/draw-source.vert?raw'

/**
 * 把一个 source texture 复制到当前 item 的局部离屏 target。
 *
 * 该 pass 不再处理 item 的平移/缩放/旋转，只负责生成局部内容纹理；
 * 这样后续如果要在 item 内插入 effect pass，可以继续复用这个输出。
 */
export class DrawSourcePass implements RenderPass {
  readonly id: string
  private readonly program: WebGLProgram

  constructor(
    id: string,
    programs: Pick<ProgramManager, 'createProgram'>,
    private readonly outputTextureId: string,
    private readonly targets: Pick<RenderTargetPool, 'releaseRenderTarget'>,
    private readonly getSourceTextureId: () => string | null,
  ) {
    this.id = id
    this.program = programs.createProgram(DRAW_SOURCE_VERTEX_SHADER, DRAW_SOURCE_FRAGMENT_SHADER)
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

    const outputTarget = ctx.targets.ensureRenderTarget(this.outputTextureId, source.width, source.height)
    const gl = ctx.gl

    // 每个 item 在独立离屏上清空并重绘，保证后续 composite 只处理当前 item 的像素。
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
