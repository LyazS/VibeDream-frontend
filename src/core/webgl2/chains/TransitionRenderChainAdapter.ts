import { RenderChain } from '@/core/webgl2/renderchain/RenderChain'
import { TransitionChainBuilder } from '@/core/webgl2/chains/TransitionChainBuilder'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'

type TransitionItem = UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'image'>

interface CachedTransitionChainEntry {
  chain: RenderChain
  signature: string
  rightItemId: string
}

export class TransitionRenderChainAdapter {
  private readonly cache = new Map<string, CachedTransitionChainEntry>()

  constructor(private readonly chainBuilder: TransitionChainBuilder) {}

  getChain(transitionItem: TransitionItem, rightItem: TransitionItem): RenderChain {
    const signature = this.chainBuilder.getSignature(transitionItem, rightItem)
    const existing = this.cache.get(transitionItem.id)

    if (
      existing &&
      existing.signature === signature &&
      existing.rightItemId === rightItem.id
    ) {
      return existing.chain
    }

    if (existing) {
      existing.chain.dispose()
    }

    const chain = this.chainBuilder.build(transitionItem, rightItem)
    this.cache.set(transitionItem.id, {
      chain,
      signature,
      rightItemId: rightItem.id,
    })

    return chain
  }

  dispose(): void {
    for (const entry of this.cache.values()) {
      entry.chain.dispose()
    }
    this.cache.clear()
  }
}
