import type { RenderPassContext } from '@/core/webgl2/renderchain/RenderPassContext'

/**
 * RenderChain 中的最小执行单元。
 *
 * 每个 pass 自己决定读取哪些 texture、写入哪个 target。
 * 链只负责顺序调度，不负责在 pass 之间隐式传递输出。
 */
export interface RenderPass {
  id: string
  render(ctx: RenderPassContext): void
  dispose(): void
}
