import { generateCommandId } from '@/core/utils/idGenerator'
import type { SimpleCommand } from '@/core/modules/commands/types'
import type { ChangePlan, ChangeOperation } from '@/core/property-system'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type {
  KeyframeSnapshot,
  PlaybackControls,
  TimelineModule,
} from './keyframes/shared'
import {
  applyKeyframeSnapshot,
  createSnapshot,
  isPlayheadInTimelineItem,
  showUserWarning,
} from './keyframes/shared'
import {
  ensureTrack,
  getCurrentGroupValue,
  removeEmptyTrack,
  sortGroupKeyframes,
} from '@/core/animation/engine'
import { applyAnimationToConfig } from '@/core/utils/animationInterpolation'
import { normalizeClipFilterConfig } from '@/core/timelineitem/filter'
import { AnimationRegistry } from '@/core/animation/registry'
import type { PropertyAnimationGroupId } from '@/core/timelineitem/bunnytype'

export class ApplyChangePlanCommand implements SimpleCommand {
  public readonly id: string
  public readonly description: string
  private beforeSnapshots = new Map<string, KeyframeSnapshot>()
  private _isDisposed = false

  constructor(
    private readonly plan: ChangePlan,
    private readonly timelineModule: TimelineModule,
    private readonly playbackControls?: PlaybackControls,
  ) {
    this.id = generateCommandId()
    this.description = plan.description

    for (const operation of plan.operations) {
      if (!this.beforeSnapshots.has(operation.timelineItemId)) {
        const item = this.timelineModule.getTimelineItem(operation.timelineItemId)
        if (!item) {
          throw new Error(`时间轴项目不存在: ${operation.timelineItemId}`)
        }
        this.beforeSnapshots.set(operation.timelineItemId, createSnapshot(item))
      }
    }
  }

  async execute(): Promise<void> {
    const refreshFrames = new Map<string, number>()

    for (const operation of this.plan.operations) {
      const item = this.timelineModule.getTimelineItem(operation.timelineItemId)
      if (!item) {
        throw new Error(`时间轴项目不存在: ${operation.timelineItemId}`)
      }

      if ('frame' in operation && !isPlayheadInTimelineItem(item, operation.frame)) {
        await showUserWarning('无法更新属性', '播放头不在当前片段内。')
        throw new Error('播放头不在当前clip时间范围内，无法更新属性')
      }

      if (operation.kind === 'no-animation-group-patch') {
        this.applyStaticPatch(item, operation)
      } else if (operation.kind === 'visual-config-patch') {
        Object.assign(item.config, operation.patch)
      } else if (operation.kind === 'audio-config-patch') {
        Object.assign(item.config, operation.patch)
      } else if (operation.kind === 'animation-keyframe-update') {
        const track = ensureTrack(item, operation.groupId)
        const keyframe = track.keyframes.find((entry) => entry.frame === operation.relativeFrame)
        if (!keyframe) {
          throw new Error(`关键帧不存在: ${operation.groupId}@${operation.relativeFrame}`)
        }
        keyframe.value = operation.value as never
        keyframe.properties = operation.value as never
        this.applyAnimatedValue(item, operation.groupId, operation.frame, operation.value)
      } else if (operation.kind === 'animation-keyframe-create') {
        ensureTrack(item, operation.groupId).keyframes.push(operation.keyframe as never)
        sortGroupKeyframes(item, operation.groupId)
        this.applyAnimatedValue(item, operation.groupId, operation.frame, operation.keyframe.value)
      } else if (operation.kind === 'animation-keyframe-delete') {
        const track = ensureTrack(item, operation.groupId)
        track.keyframes = track.keyframes.filter((entry) => entry.frame !== operation.relativeFrame)
        removeEmptyTrack(item, operation.groupId)
      }
      if ('frame' in operation) {
        refreshFrames.set(operation.timelineItemId, operation.frame)
        this.playbackControls?.seekTo(operation.frame)
      }
    }

    for (const [timelineItemId, frame] of refreshFrames) {
      const item = this.timelineModule.getTimelineItem(timelineItemId)
      if (!item) {
        throw new Error(`时间轴项目不存在: ${timelineItemId}`)
      }
      applyAnimationToConfig(item, frame)
    }
  }

  async undo(): Promise<void> {
    for (const [timelineItemId, snapshot] of this.beforeSnapshots) {
      const item = this.timelineModule.getTimelineItem(timelineItemId)
      if (!item) {
        throw new Error(`时间轴项目不存在: ${timelineItemId}`)
      }
      await applyKeyframeSnapshot(item, snapshot)
      const frame = this.getRefreshFrame(timelineItemId)
      if (frame !== null) {
        applyAnimationToConfig(item, frame)
      }
    }
  }

  private getRefreshFrame(timelineItemId: string): number | null {
    const operation = this.plan.operations.find((entry) => entry.timelineItemId === timelineItemId)
    return operation && 'frame' in operation ? operation.frame : null
  }

  private applyStaticPatch(
    item: UnifiedTimelineItemData,
    operation: Extract<ChangeOperation, { kind: 'no-animation-group-patch' }>,
  ): void {
    if (operation.target === 'config') {
      Object.assign(item.config, operation.patch)
      return
    }

    if (operation.target === 'maskConfig') {
      if (!operation.groupId) {
        throw new Error(`蒙版属性缺少动画组: ${operation.timelineItemId}`)
      }
      AnimationRegistry.get(operation.groupId).applyValue(item, operation.patch as never)
      return
    }

    if (operation.target === 'filterEffect') {
      if (!item.filterEffect) {
        throw new Error(`滤镜效果不存在，无法更新属性: ${operation.timelineItemId}`)
      }
      const filterEffectPatch = operation.patch as {
        intensity?: number
        params?: Record<string, unknown>
      }
      const nextFilterEffect = normalizeClipFilterConfig({
        ...item.filterEffect,
        ...filterEffectPatch,
        params: {
          ...item.filterEffect.params,
          ...(filterEffectPatch.params ?? {}),
        },
      })
      item.filterEffect = nextFilterEffect
      item.runtime.renderFilterEffect = nextFilterEffect
      return
    }
  }

  private applyAnimatedValue(
    item: UnifiedTimelineItemData,
    groupId: PropertyAnimationGroupId,
    frame: number,
    fallbackValue: object,
  ): void {
    const definition = AnimationRegistry.get(groupId)
    if (definition.scope === 'filter') {
      if (!item.filterEffect) {
        throw new Error(`滤镜效果不存在，无法更新属性: ${item.id}`)
      }
      const currentValue = getCurrentGroupValue(item, frame, groupId)
      definition.applyValue(item, currentValue as never)
      return
    }

    if (definition.scope === 'mask') {
      const currentValue = getCurrentGroupValue(item, frame, groupId)
      definition.applyValue(item, currentValue as never)
      return
    }

    Object.assign(item.config, fallbackValue)
  }

  get isDisposed(): boolean {
    return this._isDisposed
  }

  dispose(): void {
    this.beforeSnapshots.clear()
    this._isDisposed = true
  }
}
