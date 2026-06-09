import { cloneDeep } from 'lodash'
import type { MediaType } from '@/core/mediaitem'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { AnimationChannelKey, AnimationGroupId, AnimationGroupValueMap } from '@/core/timelineitem/bunnytype'
import { normalizeAnimationGroupId } from '@/core/timelineitem/bunnytype'
import { setGroupValue } from './engine'

type GroupPatchMap = Partial<Record<AnimationGroupId, Record<string, number>>>

export interface AnimationSessionState {
  isActive: boolean
  originalConfig: unknown
  originalAnimation: unknown
  originalFilterEffect: unknown
  pendingPatches: GroupPatchMap
}

export class AnimationSession {
  private state: AnimationSessionState = {
    isActive: false,
    originalConfig: null,
    originalAnimation: null,
    originalFilterEffect: null,
    pendingPatches: {},
  }

  begin(item: UnifiedTimelineItemData<MediaType>) {
    if (this.state.isActive) return
    this.state = {
      isActive: true,
      originalConfig: cloneDeep(item.config),
      originalAnimation: cloneDeep(item.animation),
      originalFilterEffect: cloneDeep(item.filterEffect),
      pendingPatches: {},
    }
  }

  apply<G extends AnimationGroupId>(
    item: UnifiedTimelineItemData<MediaType>,
    frame: number,
    rawGroupId: G | AnimationChannelKey,
    patch: Partial<AnimationGroupValueMap[G]>,
  ) {
    const groupId = normalizeAnimationGroupId(rawGroupId) as G
    if (!groupId) return
    this.begin(item)
    const previous = this.state.pendingPatches[groupId] ?? {}
    this.state.pendingPatches[groupId] = {
      ...(previous as Record<string, number>),
      ...(patch as Record<string, number>),
    }
    setGroupValue(item, frame, groupId, patch as never)
  }

  restore(item: UnifiedTimelineItemData<MediaType>) {
    if (!this.state.isActive) return
    item.config = cloneDeep(this.state.originalConfig) as typeof item.config
    item.animation = cloneDeep(this.state.originalAnimation) as typeof item.animation
    item.filterEffect = cloneDeep(this.state.originalFilterEffect) as typeof item.filterEffect
    item.runtime.renderFilterEffect = cloneDeep(this.state.originalFilterEffect) as typeof item.runtime.renderFilterEffect
  }

  commit(item: UnifiedTimelineItemData<MediaType>) {
    const patches = cloneDeep(this.state.pendingPatches)
    this.restore(item)
    this.reset()
    return patches
  }

  cancel(item: UnifiedTimelineItemData<MediaType>) {
    this.restore(item)
    this.reset()
  }

  reset() {
    this.state = {
      isActive: false,
      originalConfig: null,
      originalAnimation: null,
      originalFilterEffect: null,
      pendingPatches: {},
    }
  }

  get pendingPatches() {
    return this.state.pendingPatches
  }

  get isActive() {
    return this.state.isActive
  }
}
