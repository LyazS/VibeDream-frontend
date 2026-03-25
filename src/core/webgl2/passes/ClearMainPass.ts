import type { RenderPass } from '@/core/webgl2/renderchain/RenderPass'
import type { RenderPassContext } from '@/core/webgl2/renderchain/RenderPassContext'

/**
 * 清空主画面双 target。
 *
 * 因为主画面采用 ping-pong 设计，起始帧必须同时清掉 read/write，
 * 否则第一次 composite 时可能会读到上一帧残留内容。
 */
export class ClearMainPass implements RenderPass {
  readonly id: string

  constructor(id = 'clear-main') {
    this.id = id
  }

  render(ctx: RenderPassContext): void {
    const { gl, mainTarget, canvasWidth, canvasHeight } = ctx

    for (const target of [mainTarget.read, mainTarget.write]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
      gl.viewport(0, 0, canvasWidth, canvasHeight)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  dispose(): void {}
}
