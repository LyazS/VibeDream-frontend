import { RenderChain } from '@/core/webgl2/renderchain/RenderChain'
import { ChainBuilder, type VisualTimelineItem } from '@/core/webgl2/chains/ChainBuilder'

interface CachedChainEntry {
  chain: RenderChain
  signature: string
  itemRef: VisualTimelineItem
}

/**
 * 把 timeline item 适配成 RenderChain。
 *
 * 当前每个 item 只生成一条固定结构的链：
 * - ItemLocalRasterPass
 * - EffectPackageFilterPass（可选）
 * - MaskPass（可选）
 * - CompositeToMainPass
 *
 * 适配器缓存链对象，避免每帧重新 new pass / chain。
 */
export class TimelineRenderChainAdapter {
  private readonly cache = new Map<string, CachedChainEntry>()

  constructor(
    private readonly chainBuilder: ChainBuilder,
  ) {}

  /**
   * 获取 item 对应的渲染链；若不存在则按当前配置创建。
   */
  getChain(item: VisualTimelineItem): RenderChain {
    const signature = this.chainBuilder.getSignature(item)
    const existing = this.cache.get(item.id)

    if (existing && existing.signature === signature && existing.itemRef === item) {
      return existing.chain
    }

    if (existing) {
      existing.chain.dispose()
    }

    const chain = this.chainBuilder.build(item)

    this.cache.set(item.id, {
      chain,
      signature,
      itemRef: item,
    })
    return chain
  }

  /**
   * 预热 item 对应的渲染链缓存，避免首次真正渲染时再创建 pass/program。
   */
  prepareChain(item: VisualTimelineItem): void {
    this.getChain(item)
  }

  /**
   * 销毁所有缓存的 chain。
   */
  dispose(): void {
    for (const cached of this.cache.values()) {
      cached.chain.dispose()
    }
    this.cache.clear()
  }
}
