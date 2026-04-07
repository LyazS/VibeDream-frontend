import type { RenderPass } from '@/core/webgl2/renderchain/RenderPass'
import type { RenderPassContext } from '@/core/webgl2/renderchain/RenderPassContext'
import type { ProgramManager } from '@/core/webgl2/runtime/ProgramManager'
import type { RenderTargetPool } from '@/core/webgl2/runtime/RenderTargetPool'
import COPY_VERTEX_SHADER from '@/core/webgl2/shaders/copy.vert?raw'

export class CrossfadePass implements RenderPass {
  readonly id: string
  private readonly program: WebGLProgram

  constructor(
    id: string,
    programs: Pick<ProgramManager, 'createProgram'>,
    private readonly outputTextureId: string,
    private readonly targets: Pick<RenderTargetPool, 'releaseRenderTarget'>,
    private readonly getFromTextureId: () => string | null,
    private readonly getToTextureId: () => string | null,
    private readonly getProgress: () => number,
    fragmentShaderSource: string,
    vertexShaderSource: string = COPY_VERTEX_SHADER,
  ) {
    this.id = id
    this.program = programs.createProgram(vertexShaderSource, fragmentShaderSource)
  }

  render(ctx: RenderPassContext): void {
    const fromTextureId = this.getFromTextureId()
    const toTextureId = this.getToTextureId()
    if (!fromTextureId || !toTextureId) {
      return
    }

    const fromTexture = ctx.textures.get(fromTextureId)
    const toTexture = ctx.textures.get(toTextureId)
    if (!fromTexture || !toTexture) {
      return
    }

    const outputTarget = ctx.targets.ensureRenderTarget(
      this.outputTextureId,
      ctx.canvasWidth,
      ctx.canvasHeight,
    )
    const gl = ctx.gl

    gl.bindFramebuffer(gl.FRAMEBUFFER, outputTarget.framebuffer)
    gl.viewport(0, 0, outputTarget.width, outputTarget.height)
    gl.useProgram(this.program)
    ctx.runtime.bindFullscreenQuad(this.program)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, fromTexture.texture)
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_fromTexture'), 0)

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, toTexture.texture)
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_toTexture'), 1)

    gl.uniform1f(gl.getUniformLocation(this.program, 'u_progress'), this.getProgress())
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  dispose(): void {
    this.targets.releaseRenderTarget(this.outputTextureId)
  }
}
