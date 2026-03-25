import { RenderChain } from '@/core/webgl2/renderchain/RenderChain'
import { ChainBuilder, type VisualTimelineItem } from '@/core/webgl2/chains/ChainBuilder'

/**
 * 把 timeline item 适配成 RenderChain。
 *
 * 当前每个 item 只生成一条固定结构的链：
 * - DrawSourcePass
 * - CompositeToMainPass
 *
 * 适配器缓存链对象，避免每帧重新 new pass / chain。
 */
export class TimelineRenderChainAdapter {
  private readonly chains = new Map<string, RenderChain>()

  constructor(
    private readonly chainBuilder: ChainBuilder,
  ) {}

  /**
   * 获取 item 对应的渲染链；若不存在则按当前配置创建。
   */
  getChain(item: VisualTimelineItem): RenderChain {
    const existing = this.chains.get(item.id)
    if (existing) {
      return existing
    }

    const chain = this.chainBuilder.build(item)

    this.chains.set(item.id, chain)
    return chain
  }

  /**
   * 销毁所有缓存的 chain。
   */
  dispose(): void {
    for (const chain of this.chains.values()) {
      chain.dispose()
    }
    this.chains.clear()
  }
}
