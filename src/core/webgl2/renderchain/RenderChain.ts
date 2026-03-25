import type { RenderPass } from '@/core/webgl2/renderchain/RenderPass'
import type { RenderPassContext } from '@/core/webgl2/renderchain/RenderPassContext'

/**
 * 顺序执行一组 RenderPass 的轻量容器。
 *
 * 第一阶段链路是严格线性的，不支持分叉、合流或条件执行；
 * 这样可以先把 item 级 source -> composite 的主路径跑通。
 */
export class RenderChain {
  constructor(
    public readonly id: string,
    private readonly passes: RenderPass[],
  ) {}

  /**
   * 串行执行链中的 pass。
   */
  render(ctx: RenderPassContext): void {
    for (const pass of this.passes) {
      pass.render(ctx)
    }
  }

  /**
   * 释放链上所有 pass 自己持有的资源。
   */
  dispose(): void {
    for (const pass of this.passes) {
      pass.dispose()
    }
  }
}
