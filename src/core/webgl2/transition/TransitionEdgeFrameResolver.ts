import { TimelineItemQueries } from '@/core/timelineitem/queries'
import {
  closeClipTransitionEdgeFrames,
  hasEnabledClipTransitionOut,
  resolveTransitionBoundaryFrames,
} from '@/core/timelineitem/transition'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { MediaType, UnifiedMediaItemData } from '@/core/mediaitem/types'

interface PendingEntry {
  signature: string
  promise: Promise<void>
}

export class TransitionEdgeFrameResolver {
  private readonly pending = new Map<string, PendingEntry>()

  constructor(
    private readonly getMediaItem: (mediaItemId: string) => UnifiedMediaItemData | undefined,
  ) {}

  async prepareItems(timelineItems: UnifiedTimelineItemData<MediaType>[]): Promise<void> {
    const tasks: Promise<void>[] = []

    for (const item of timelineItems) {
      if (!hasEnabledClipTransitionOut(item)) {
        continue
      }

      if (!item.runtime.transition) {
        continue
      }

      if (
        item.runtime.transition.bindingState !== 'bound' &&
        item.runtime.transition.bindingState !== 'waiting-edge'
      ) {
        continue
      }

      tasks.push(this.prepareItem(item, timelineItems))
    }

    await Promise.all(tasks)
  }

  private async prepareItem(
    item: UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'image'>,
    timelineItems: UnifiedTimelineItemData<MediaType>[],
  ): Promise<void> {
    const transitionRuntime = item.runtime.transition
    if (!transitionRuntime?.rightItemId || transitionRuntime.seamFrame === null) {
      return
    }

    const rightItem = timelineItems.find((candidate) => candidate.id === transitionRuntime.rightItemId)
    if (!rightItem || !TimelineItemQueries.supportsClipTransitionOut(rightItem)) {
      return
    }

    const signature = this.buildSignature(item, rightItem)
    const hasPreparedEdges =
      transitionRuntime.edgeSignature === signature &&
      Boolean(transitionRuntime.edgeFrames?.leftTail) &&
      Boolean(transitionRuntime.edgeFrames?.rightHead)

    if (hasPreparedEdges) {
      if (transitionRuntime.bindingState === 'waiting-edge') {
        transitionRuntime.bindingState = 'bound'
      }
      return
    }

    const pendingEntry = this.pending.get(item.id)
    if (pendingEntry?.signature === signature) {
      await pendingEntry.promise
      return
    }

    transitionRuntime.bindingState = 'waiting-edge'

    const promise = this.prepareEdgeFrames(item, rightItem, signature)
    this.pending.set(item.id, {
      signature,
      promise,
    })

    try {
      await promise
    } finally {
      const latestPendingEntry = this.pending.get(item.id)
      if (latestPendingEntry?.signature === signature) {
        this.pending.delete(item.id)
      }
    }
  }

  private async prepareEdgeFrames(
    leftItem: UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'image'>,
    rightItem: UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'image'>,
    signature: string,
  ): Promise<void> {
    const transitionRuntime = leftItem.runtime.transition
    if (!transitionRuntime) {
      return
    }

    const leftBoundaryFrames = resolveTransitionBoundaryFrames(leftItem)
    const rightBoundaryFrames = resolveTransitionBoundaryFrames(rightItem)

    const [leftTail, rightHead] = await Promise.all([
      this.createEdgeFrameSource(leftItem, leftBoundaryFrames.clipTailFrame),
      this.createEdgeFrameSource(rightItem, rightBoundaryFrames.clipHeadFrame),
    ])

    if (!leftTail || !rightHead) {
      leftTail?.close()
      rightHead?.close()
      transitionRuntime.bindingState = 'waiting-edge'
      return
    }

    if (transitionRuntime.edgeFrames) {
      closeClipTransitionEdgeFrames(transitionRuntime.edgeFrames)
    }

    transitionRuntime.edgeFrames = {
      leftTail,
      rightHead,
    }
    transitionRuntime.edgeSignature = signature
    transitionRuntime.bindingState = 'bound'
  }

  private buildSignature(
    leftItem: UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'image'>,
    rightItem: UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'image'>,
  ): string {
    const leftBoundaryFrames = resolveTransitionBoundaryFrames(leftItem)
    const rightBoundaryFrames = resolveTransitionBoundaryFrames(rightItem)
    const leftMediaItem = this.getMediaItem(leftItem.mediaItemId)
    const rightMediaItem = this.getMediaItem(rightItem.mediaItemId)

    return [
      leftItem.id,
      rightItem.id,
      leftItem.trackId,
      rightItem.trackId,
      leftItem.timelineStatus,
      rightItem.timelineStatus,
      leftItem.timeRange.timelineStartTime,
      leftItem.timeRange.timelineEndTime,
      rightItem.timeRange.timelineStartTime,
      rightItem.timeRange.timelineEndTime,
      leftBoundaryFrames.clipTailFrame,
      rightBoundaryFrames.clipHeadFrame,
      Boolean(leftItem.runtime.bunnyClip),
      Boolean(rightItem.runtime.bunnyClip),
      Boolean(leftMediaItem?.runtime.bunny?.imageClip),
      Boolean(rightMediaItem?.runtime.bunny?.imageClip),
    ].join(':')
  }

  private async createEdgeFrameSource(
    item: UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'image'>,
    clipFrame: number,
  ): Promise<ImageBitmap | VideoFrame | null> {
    if (TimelineItemQueries.isImageTimelineItem(item)) {
      const mediaItem = this.getMediaItem(item.mediaItemId)
      const imageClip = mediaItem?.runtime.bunny?.imageClip
      return imageClip ? createImageBitmap(imageClip) : null
    }

    const bunnyClip = item.runtime.bunnyClip
    if (!bunnyClip) {
      return null
    }

    const result = await bunnyClip.getSampleN(BigInt(clipFrame))
    if (result.state !== 'success' || !result.video) {
      result.video?.close()
      return null
    }

    const videoFrame = result.video.toVideoFrame()
    try {
      return videoFrame.clone()
    } finally {
      videoFrame.close()
      result.video.close()
    }
  }
}
