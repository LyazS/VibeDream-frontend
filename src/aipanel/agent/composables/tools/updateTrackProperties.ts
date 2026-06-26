import type { ToolDefinition } from '../core/toolTypes'
import { buildToolError, buildToolSuccess } from './utils/result'
import { createTrackCommandHelpers, executeSingleTrackCommand } from './trackEditShared'

type TrackPatchKey = 'name' | 'visible' | 'muted'

const SUPPORTED_KEYS: TrackPatchKey[] = ['name', 'visible', 'muted']

function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function validatePatchValue(key: TrackPatchKey, value: unknown): string | null {
  if (key === 'name') {
    return typeof value === 'string' && value.trim() ? null : 'name 必须是非空字符串。'
  }

  return typeof value === 'boolean' ? null : `${key} 必须是布尔值。`
}

function getTrackPropertyValue(track: any, key: TrackPatchKey): string | boolean {
  switch (key) {
    case 'name':
      return track.name
    case 'visible':
      return track.isVisible
    case 'muted':
      return track.isMuted
  }
}

export async function executeUpdateTrackProperties(args: Record<string, any>) {
  const { trackId, match, patch } = args

  if (typeof trackId !== 'string' || !trackId) {
    return buildToolError('update_track_properties', 'invalid_arguments', 'trackId 是必填字符串。')
  }

  if (!isPlainObject(match) || !isPlainObject(patch)) {
    return buildToolError(
      'update_track_properties',
      'invalid_arguments',
      'match 和 patch 都必须是对象。',
    )
  }

  const matchKeys = Object.keys(match)
  const patchKeys = Object.keys(patch)

  if (!matchKeys.length) {
    return buildToolError(
      'update_track_properties',
      'invalid_arguments',
      'match 和 patch 至少需要包含 1 个属性。',
    )
  }

  const sortedMatchKeys = [...matchKeys].sort()
  const sortedPatchKeys = [...patchKeys].sort()
  if (JSON.stringify(sortedMatchKeys) !== JSON.stringify(sortedPatchKeys)) {
    return buildToolError(
      'update_track_properties',
      'invalid_arguments',
      'match 和 patch 的 key 集合必须完全一致。',
    )
  }

  for (const key of matchKeys) {
    if (!SUPPORTED_KEYS.includes(key as TrackPatchKey)) {
      return buildToolError(
        'update_track_properties',
        'invalid_arguments',
        `不支持的轨道属性 ${key}。仅支持 ${SUPPORTED_KEYS.join('、')}。`,
      )
    }
  }

  try {
    const helpers = createTrackCommandHelpers()
    const { store } = helpers
    const track = store.getTrack(trackId)
    if (!track) {
      return buildToolError(
        'update_track_properties',
        'track_not_found',
        `未找到轨道 ${trackId}。请使用 list_tracks 查看正确轨道 ID。`,
        { trackId },
      )
    }

    if (matchKeys.includes('visible') && track.type === 'audio') {
      return buildToolError(
        'update_track_properties',
        'invalid_operation',
        'audio 轨道不支持 visible 属性。',
        { trackId, trackType: track.type, property: 'visible' },
      )
    }

    if (matchKeys.includes('muted') && track.type === 'text') {
      return buildToolError(
        'update_track_properties',
        'invalid_operation',
        'text 轨道不支持 muted 属性。',
        { trackId, trackType: track.type, property: 'muted' },
      )
    }

    const before: Record<string, string | boolean> = {}
    const after: Record<string, string | boolean> = {}

    for (const rawKey of matchKeys) {
      const key = rawKey as TrackPatchKey
      const currentValue = getTrackPropertyValue(track, key)
      const validateMatchMessage = validatePatchValue(key, match[key])
      if (validateMatchMessage) {
        return buildToolError('update_track_properties', 'invalid_arguments', validateMatchMessage)
      }

      const validatePatchMessage = validatePatchValue(key, patch[key])
      if (validatePatchMessage) {
        return buildToolError('update_track_properties', 'invalid_arguments', validatePatchMessage)
      }

      if (currentValue !== match[key]) {
        return buildToolError(
          'update_track_properties',
          'conflict',
          `轨道 ${trackId} 的 ${key} 当前值与 match 不一致。`,
          {
            trackId,
            property: key,
            expected: match[key],
            actual: currentValue,
          },
        )
      }

      before[key] = currentValue
    }

    for (const rawKey of matchKeys) {
      const key = rawKey as TrackPatchKey
      const nextValue = patch[key]

      if (key === 'name') {
        await executeSingleTrackCommand(helpers.createRenameTrackCommand(trackId, nextValue.trim()))
        continue
      }

      if (key === 'visible') {
        await executeSingleTrackCommand(helpers.createSetTrackVisibilityCommand(trackId, nextValue))
        continue
      }

      await executeSingleTrackCommand(helpers.createSetTrackMuteCommand(trackId, nextValue))
    }

    const updatedTrack = store.getTrack(trackId)
    if (!updatedTrack) {
      return buildToolError(
        'update_track_properties',
        'internal_error',
        `轨道 ${trackId} 更新后不存在。`,
      )
    }

    for (const rawKey of matchKeys) {
      const key = rawKey as TrackPatchKey
      after[key] = getTrackPropertyValue(updatedTrack, key)
    }

    return buildToolSuccess(
      'update_track_properties',
      {
        trackId,
        before,
        after,
      },
      `已更新轨道 ${trackId} 的 ${matchKeys.length} 个属性。`,
    )
  } catch (error: any) {
    return buildToolError(
      'update_track_properties',
      'internal_error',
      error instanceof Error ? error.message : String(error),
    )
  }
}

export const updateTrackPropertiesTool: ToolDefinition = {
  name: 'update_track_properties',
  execute: executeUpdateTrackProperties,
} as ToolDefinition
