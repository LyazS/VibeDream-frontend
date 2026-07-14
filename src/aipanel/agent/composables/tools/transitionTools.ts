import { searchTransitions } from '@/aipanel/agent/services/transitionSearchService'
import { cloneDeep } from 'lodash'
import { UpdateTransitionConfigCommand } from '@/core/modules/commands/timelineCommands'
import { useUnifiedStore } from '@/core/unifiedStore'
import { framesToTimecode } from '@/core/utils/timeUtils'
import type { ToolDefinition } from '../core/toolTypes'
import { createTimelineCommandHelpers } from './timelineEditShared'
import { isValidAgentToolTimecode, parseAgentToolTimecode } from './utils/timecode'
import { buildToolError, buildToolSuccess } from './utils/result'
import {
  buildTransitionItemId,
  getTrackItems,
  getTransitionSnapshot,
  parseTransitionItemId,
  resolveTransitionTemplate,
  toolError,
  transitionOverlaps,
  transitionTimelineOutput,
  validateTransitionParam,
} from './transitionItemShared'

function requireTransitionTarget(args: Record<string, any>) {
  const { trackId, leftClipId, rightClipId, seamTime } = args
  if (![trackId, leftClipId, rightClipId, seamTime].every((value) => typeof value === 'string' && value)) {
    throw toolError('invalid_arguments', 'trackId、leftClipId、rightClipId 和 seamTime 为必填项。')
  }
  if (!isValidAgentToolTimecode(seamTime)) throw toolError('invalid_timecode', 'seamTime 必须是 HH:MM:SS+FF 时间码。')
  const store = useUnifiedStore()
  const track = store.getTrack(trackId)
  if (!track || track.type !== 'video') throw toolError('invalid_transition_target', '目标必须是存在的视频轨道。')
  const left = store.getTimelineItem(leftClipId)
  const right = store.getTimelineItem(rightClipId)
  const seamFrame = parseAgentToolTimecode(seamTime)
  if (!left || !right || left.trackId !== trackId || right.trackId !== trackId || !getTrackItems(trackId).includes(left) || !getTrackItems(trackId).includes(right)) {
    throw toolError('invalid_transition_target', '左右 clip 必须属于目标轨道。')
  }
  if (left.timeRange.timelineEndTime !== seamFrame || right.timeRange.timelineStartTime !== seamFrame) {
    throw toolError('invalid_transition_target', 'seamTime 必须同时等于左 clip 的结束和右 clip 的开始。')
  }
  const neighbors = getTrackItems(trackId).filter((item) => item.timeRange.timelineStartTime === seamFrame)
  if (neighbors.length !== 1 || neighbors[0].id !== rightClipId) {
    throw toolError('invalid_transition_target', 'rightClipId 不是当前拼接点唯一的右侧相邻 clip。')
  }
  return { left, right, seamFrame }
}

export async function executeSearchTransitions(args: Record<string, any>) {
  if (typeof args.query !== 'string' || !args.query.trim()) return buildToolError('search_transitions', 'invalid_arguments', 'query 必须是非空字符串。')
  try {
    const response = await searchTransitions(args.query.trim(), args.topK)
    return buildToolSuccess('search_transitions', {
      results: response.results.map((item) => ({
        templateId: item.id,
        name: item.name.en || item.id,
        description: item.agent_description || item.summary?.zh || item.summary?.en || '',
      })),
    })
  } catch (error: any) {
    return buildToolError('search_transitions', 'search_failed', error instanceof Error ? error.message : String(error))
  }
}

export async function executeApplyTransition(args: Record<string, any>) {
  try {
    if (typeof args.templateId !== 'string' || !args.templateId.trim()) throw toolError('invalid_arguments', 'templateId 为必填项。')
    requireTransitionTarget(args)
    const { identity, payload } = await resolveTransitionTemplate(args.templateId.trim())
    // Installing a package is asynchronous; reject a target that changed while awaiting it.
    let target
    try {
      target = requireTransitionTarget(args)
    } catch (error) {
      throw toolError(
        'stale_transition_target',
        error instanceof Error ? error.message : '转场目标在模板安装期间发生变化。',
      )
    }
    const config = {
      effectPackageId: identity.effectPackageId,
      templateId: identity.templateId,
      packageVersion: identity.packageVersion,
      catalogVersion: identity.catalogVersion,
      durationFrames: payload.host.transition.defaultDurationFrames,
      params: cloneDeep(payload.defaultParams),
      packagePayload: payload,
    }
    const preview = { ...target.left, exRenderConfig: { ...target.left.exRenderConfig, transition: config } }
    const snapshot = getTransitionSnapshot(preview)
    if (!snapshot || transitionOverlaps(snapshot, target.left.id)) throw toolError('transition_overlap', '转场有效范围会与共享 clip 上的已有转场重叠。')
    await useUnifiedStore().updateTransitionConfigWithHistory(target.left.id, config)
    const created = getTransitionSnapshot(target.left)
    return buildToolSuccess('apply_transition', {
      itemId: buildTransitionItemId(target.left.id, config.templateId),
      item: created && { ...transitionTimelineOutput(created), transition: { templateId: config.templateId, duration: framesToTimecode(config.durationFrames), params: config.params } },
    })
  } catch (error: any) {
    return buildToolError('apply_transition', error?.toolCode || 'internal_error', error instanceof Error ? error.message : String(error), error?.toolDetails)
  }
}

export async function executeRemoveItem(args: Record<string, any>) {
  const itemIds = args.itemIds
  if (!Array.isArray(itemIds) || !itemIds.length || !itemIds.every((id) => typeof id === 'string' && id)) return buildToolError('remove_item', 'invalid_arguments', 'itemIds 必须是非空字符串数组。')
  const normalizedIds = [...new Set(itemIds)]
  try {
    const { store, createRemoveTimelineItemCommand } = createTimelineCommandHelpers()
    const transitionItems: ReturnType<typeof getTransitionSnapshot>[] = []
    const clipIds: string[] = []
    for (const itemId of normalizedIds) {
      const parsed = parseTransitionItemId(itemId)
      if (!parsed) {
        if (itemId.startsWith('transition:')) throw toolError('invalid_transition_item', `无效转场 itemId: ${itemId}`)
        if (!store.getTimelineItem(itemId)) throw toolError('item_not_found', `未找到 clip: ${itemId}`)
        clipIds.push(itemId)
        continue
      }
      const left = store.getTimelineItem(parsed.leftClipId)
      const snapshot = left && getTransitionSnapshot(left)
      if (!snapshot) throw toolError('transition_not_found', `未找到转场: ${itemId}`)
      if (snapshot.config.templateId !== parsed.templateId) throw toolError('stale_transition_item', '转场模板已被替换，拒绝删除新的转场。')
      transitionItems.push(snapshot)
    }
    const batch = store.startBatch(`删除 ${normalizedIds.length} 个时间轴项目`)
    for (const transition of transitionItems) {
      if (!transition) continue
      batch.addCommand(new UpdateTransitionConfigCommand(transition.leftClipId, transition.config, undefined, {
        getTimelineItem: (id) => store.getTimelineItem(id),
        setTimelineItemTransitionConfigForCmd: store.setTimelineItemTransitionConfigForCmd.bind(store),
      }))
    }
    for (const clipId of clipIds) batch.addCommand(createRemoveTimelineItemCommand(clipId))
    await store.executeBatchCommand(batch.build())
    return buildToolSuccess('remove_item', { removedItemIds: normalizedIds })
  } catch (error: any) {
    return buildToolError('remove_item', error?.toolCode || 'internal_error', error instanceof Error ? error.message : String(error), error?.toolDetails)
  }
}

export async function executeReadTransitionItem(itemId: string, propertyGroups: unknown) {
  const parsed = parseTransitionItemId(itemId)
  if (!parsed) throw toolError('invalid_transition_item', '无效的转场 itemId。')
  const left = useUnifiedStore().getTimelineItem(parsed.leftClipId)
  const snapshot = left && getTransitionSnapshot(left)
  if (!snapshot) throw toolError('transition_not_found', '转场不存在。')
  if (snapshot.config.templateId !== parsed.templateId) throw toolError('stale_transition_item', '转场模板已被替换。')
  if (!Array.isArray(propertyGroups) || !propertyGroups.length || propertyGroups.some((group) => group !== 'timeline' && group !== 'transition')) throw toolError('invalid_property_group', '转场只支持 timeline 和 transition 属性组。')
  const groups: Record<string, unknown> = {}
  if (propertyGroups.includes('timeline')) groups.timeline = transitionTimelineOutput(snapshot)
  if (propertyGroups.includes('transition')) groups.transition = {
    templateId: snapshot.config.templateId,
    duration: framesToTimecode(snapshot.config.durationFrames),
    params: cloneDeep(snapshot.config.params),
  }
  return { itemId: snapshot.itemId, itemType: 'transition', groups }
}

export async function executeUpdateTransitionItem(itemId: string, match: unknown, apply: unknown) {
  const data = await executeReadTransitionItem(itemId, ['timeline', 'transition'])
  if (!match || typeof match !== 'object' || Array.isArray(match) || !apply || typeof apply !== 'object' || Array.isArray(apply) || !Object.keys(apply).length) throw toolError('invalid_arguments', 'match 和 apply 必须是非空对象。')
  const timeline = data.groups.timeline as { leftClipId: string }
  const left = useUnifiedStore().getTimelineItem(timeline.leftClipId)
  const snapshot = left && getTransitionSnapshot(left)
  if (!snapshot) throw toolError('transition_not_found', '转场不存在。')
  const next = cloneDeep(snapshot.config)
  if (!next.packagePayload) {
    const { payload } = await resolveTransitionTemplate(next.templateId)
    next.packagePayload = payload
  }
  for (const key of Object.keys(apply as Record<string, unknown>)) {
    const current = key === 'transition.duration' ? framesToTimecode(snapshot.config.durationFrames) : key.startsWith('transition.params.') ? snapshot.config.params[key.slice('transition.params.'.length)] : undefined
    if (JSON.stringify(current) !== JSON.stringify((match as Record<string, unknown>)[key])) throw toolError('match_failed', `属性匹配失败: ${key}`, { expected: (match as Record<string, unknown>)[key], actual: current })
    if (key === 'transition.duration') {
      const value = (apply as Record<string, unknown>)[key]
      if (typeof value !== 'string' || !isValidAgentToolTimecode(value)) throw toolError('invalid_timecode', 'transition.duration 必须是 HH:MM:SS+FF。')
      next.durationFrames = parseAgentToolTimecode(value)
      if (next.durationFrames < 2) throw toolError('invalid_transition_duration', 'transition.duration 至少为 2 帧。')
    } else if (key.startsWith('transition.params.')) {
      const parameterKey = key.slice('transition.params.'.length)
      const definition = next.packagePayload?.parameterSchema[parameterKey]
      if (!definition) throw toolError('invalid_patch_path', `未定义的转场参数: ${parameterKey}`)
      next.params[parameterKey] = validateTransitionParam((apply as Record<string, unknown>)[key], definition, key)
    } else throw toolError('invalid_patch_path', `不支持的转场属性: ${key}`)
  }
  const preview = { ...snapshot.leftItem, exRenderConfig: { ...snapshot.leftItem.exRenderConfig, transition: next } }
  const nextSnapshot = getTransitionSnapshot(preview)
  if (!nextSnapshot || transitionOverlaps(nextSnapshot, snapshot.leftClipId)) throw toolError('transition_overlap', '新的转场时长会与共享 clip 上的已有转场重叠。')
  await useUnifiedStore().updateTransitionConfigWithHistory(snapshot.leftClipId, next)
  return {
    itemId: snapshot.itemId,
    itemType: 'transition',
    before: data.groups.transition,
    after: {
      templateId: next.templateId,
      duration: framesToTimecode(next.durationFrames),
      params: cloneDeep(next.params),
    },
  }
}

export const searchTransitionsTool: ToolDefinition = { name: 'search_transitions', execute: executeSearchTransitions } as ToolDefinition
export const applyTransitionTool: ToolDefinition = { name: 'apply_transition', execute: executeApplyTransition } as ToolDefinition
export const removeItemTool: ToolDefinition = { name: 'remove_item', execute: executeRemoveItem } as ToolDefinition
