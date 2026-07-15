import type { MediaType, UnifiedMediaItemData } from '@/core/mediaitem/types'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import { TimelineItemTransitioner } from '@/core/managers/sync/TimelineItemTransitioner'
import type { ResolveCheckContext, ResolveContext, ResourceResolver } from '../ResourceResolver'
import type { ResourcePolicy, ResourceRequest } from '../ResourceTypes'
import { createMediaReadyRequest } from './MediaReadyResolver'

export const TIMELINE_ITEM_READY_RESOURCE_TYPE = 'timeline-item-ready'

export interface TimelineItemReadyInput {
  timelineItemId: string
}

export interface TimelineItemReadyResult {
  timelineItemId: string
  status: 'ready' | 'skipped'
}

type TimelineItemReadyModule = {
  getTimelineItem: (id: string) => UnifiedTimelineItemData<MediaType> | undefined
  getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined
}

export class TimelineItemReadyResolver
  implements ResourceResolver<TimelineItemReadyInput, TimelineItemReadyResult>
{
  readonly type = TIMELINE_ITEM_READY_RESOURCE_TYPE

  constructor(private readonly module: TimelineItemReadyModule) {}

  getKey(input: TimelineItemReadyInput): string {
    return input.timelineItemId
  }

  async isSatisfied(
    ctx: ResolveCheckContext<TimelineItemReadyInput>,
  ): Promise<TimelineItemReadyResult | null> {
    const timelineItem = this.module.getTimelineItem(ctx.input.timelineItemId)
    console.log('[TimelineItemReadyResolver][isSatisfied]', {
      timelineItemId: ctx.input.timelineItemId,
      exists: !!timelineItem,
      timelineStatus: timelineItem?.timelineStatus,
      mediaItemId: timelineItem?.mediaItemId,
      isInitialized: timelineItem?.runtime.isInitialized,
    })

    if (!timelineItem) {
      return {
        timelineItemId: ctx.input.timelineItemId,
        status: 'skipped',
      }
    }

    if (
      timelineItem.timelineStatus === 'ready' ||
      TimelineItemQueries.isTextTimelineItem(timelineItem)
    ) {
      return {
        timelineItemId: timelineItem.id,
        status: 'ready',
      }
    }

    return null
  }

  async getDependencies(ctx: ResolveContext<TimelineItemReadyInput>): Promise<ResourceRequest[]> {
    const timelineItem = this.module.getTimelineItem(ctx.input.timelineItemId)
    console.log('[TimelineItemReadyResolver][getDependencies]', {
      timelineItemId: ctx.input.timelineItemId,
      exists: !!timelineItem,
      timelineStatus: timelineItem?.timelineStatus,
      mediaItemId: timelineItem?.mediaItemId,
      isText: timelineItem ? TimelineItemQueries.isTextTimelineItem(timelineItem) : false,
    })

    if (
      !timelineItem ||
      timelineItem.timelineStatus === 'ready' ||
      TimelineItemQueries.isTextTimelineItem(timelineItem) ||
      !timelineItem.mediaItemId
    ) {
      return []
    }

    return [createMediaReadyRequest(timelineItem.mediaItemId)]
  }

  async resolve(ctx: ResolveContext<TimelineItemReadyInput>): Promise<TimelineItemReadyResult> {
    const timelineItem = this.module.getTimelineItem(ctx.input.timelineItemId)
    console.log('[TimelineItemReadyResolver][resolve] enter', {
      timelineItemId: ctx.input.timelineItemId,
      exists: !!timelineItem,
      timelineStatus: timelineItem?.timelineStatus,
      mediaItemId: timelineItem?.mediaItemId,
      isInitialized: timelineItem?.runtime.isInitialized,
    })

    if (!timelineItem) {
      ctx.update({
        progress: 1,
        stage: 'skipped',
        message: `Timeline item missing: ${ctx.input.timelineItemId}`,
      })
      return {
        timelineItemId: ctx.input.timelineItemId,
        status: 'skipped',
      }
    }

    if (timelineItem.timelineStatus === 'ready') {
      ctx.update({
        progress: 1,
        stage: 'ready',
        message: `Timeline item ready: ${timelineItem.id}`,
      })
      return {
        timelineItemId: timelineItem.id,
        status: 'ready',
      }
    }

    if (TimelineItemQueries.isTextTimelineItem(timelineItem)) {
      ctx.update({
        progress: 1,
        stage: 'skipped',
        message: `Text timeline item does not need ready transition: ${timelineItem.id}`,
      })
      return {
        timelineItemId: timelineItem.id,
        status: 'skipped',
      }
    }

    if (!timelineItem.mediaItemId) {
      throw new Error(`Timeline item missing mediaItemId: ${timelineItem.id}`)
    }

    const mediaItem = this.module.getMediaItem(timelineItem.mediaItemId)
    if (!mediaItem) {
      throw new Error(`Media item not found: ${timelineItem.mediaItemId}`)
    }
    console.log('[TimelineItemReadyResolver][resolve] media ready dependency satisfied', {
      timelineItemId: timelineItem.id,
      mediaItemId: mediaItem.id,
      mediaStatus: mediaItem.mediaStatus,
      timelineStatus: timelineItem.timelineStatus,
      isInitialized: timelineItem.runtime.isInitialized,
    })

    const latestTimelineItem = this.module.getTimelineItem(timelineItem.id)
    if (!latestTimelineItem) {
      ctx.update({
        progress: 1,
        stage: 'skipped',
        message: `Timeline item removed before ready: ${timelineItem.id}`,
      })
      return {
        timelineItemId: timelineItem.id,
        status: 'skipped',
      }
    }

    await new TimelineItemTransitioner(latestTimelineItem.id, mediaItem).transitionToReady({
      description: `TimelineItemReadyResolver: ${latestTimelineItem.id}`,
    })
    console.log('[TimelineItemReadyResolver][resolve] transitioned', {
      timelineItemId: latestTimelineItem.id,
      timelineStatus: latestTimelineItem.timelineStatus,
      isInitialized: latestTimelineItem.runtime.isInitialized,
    })

    ctx.update({
      progress: 1,
      stage: 'ready',
      message: `Timeline item ready: ${latestTimelineItem.id}`,
    })

    return {
      timelineItemId: latestTimelineItem.id,
      status: 'ready',
    }
  }
}

export function createTimelineItemReadyResolver(
  module: TimelineItemReadyModule,
): TimelineItemReadyResolver {
  return new TimelineItemReadyResolver(module)
}

export function createTimelineItemReadyRequest(
  timelineItemId: string,
  policy?: ResourcePolicy,
): ResourceRequest<TimelineItemReadyInput> {
  return {
    type: TIMELINE_ITEM_READY_RESOURCE_TYPE,
    key: timelineItemId,
    input: {
      timelineItemId,
    },
    policy: {
      queue: 'local-heavy',
      ...policy,
    },
  }
}
