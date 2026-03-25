import type { RenderPass } from '@/core/webgl2/renderchain/RenderPass'
import type { RenderPassContext } from '@/core/webgl2/renderchain/RenderPassContext'
import type { ProgramManager } from '@/core/webgl2/runtime/ProgramManager'
import FULLSCREEN_VERTEX_SHADER from '@/core/webgl2/shaders/fullscreen.vert?raw'
import PRESENT_FRAGMENT_SHADER from '@/core/webgl2/shaders/present.frag?raw'

/**
 * 把主画面输出到默认 framebuffer，也就是用户实际看到的 canvas。
 *
 * Present 不参与 main target 的状态推进，只消费当前最新结果。
 * 在“composite 前 swap + copy”的时序下，最新完整结果保存在 `mainTarget.write`。
 */
export class PresentPass implements RenderPass {
  readonly id: string
  private readonly program: WebGLProgram

  constructor(
    programs: Pick<ProgramManager, 'createProgram'>,
    id = 'present',
  ) {
    this.id = id
    this.program = programs.createProgram(FULLSCREEN_VERTEX_SHADER, PRESENT_FRAGMENT_SHADER)
  }

  render(ctx: RenderPassContext): void {
    const mainTexture = ctx.textures.get(ctx.mainTarget.write.textureId)
    if (!mainTexture) {
      return
    }

    const gl = ctx.gl

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, ctx.canvasWidth, ctx.canvasHeight)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this.program)
    ctx.runtime.bindFullscreenQuad(this.program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, mainTexture.texture)
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_texture'), 0)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  dispose(): void {}
}
