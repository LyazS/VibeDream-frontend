import { useUnifiedStore } from '@/core/unifiedStore'
import {
  resolveProjectResolutionFromCanvas,
  validateProjectCanvasDimensions,
} from '@/core/utils/projectResolutionPresets'
import type { VideoResolution } from '@/core/types'
import type { ToolDefinition } from '../core/toolTypes'
import { getCurrentProjectInfo, type ProjectInfoPayload } from './projectInfoShared'
import { buildToolError, buildToolSuccess } from './utils/result'

type ProjectInfoKey = 'name' | 'description' | 'canvas'

interface CanvasMatchPayload {
  width: number
  height: number
  presetKey: string | null
}

interface CanvasApplyPresetPayload {
  presetKey: string
}

interface CanvasApplySizePayload {
  width: number
  height: number
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isProjectInfoKey(value: string): value is ProjectInfoKey {
  return value === 'name' || value === 'description' || value === 'canvas'
}

function normalizeTopLevelKeys(value: Record<string, any>): ProjectInfoKey[] | null {
  const keys = Object.keys(value)
  if (keys.length === 0) {
    return null
  }
  if (!keys.every(isProjectInfoKey)) {
    return null
  }
  return keys as ProjectInfoKey[]
}

function validateNameValue(value: unknown, key: 'name' | 'description'): string | null {
  if (typeof value !== 'string') {
    return `${key} 必须是字符串。`
  }
  if (key === 'name' && !value.trim()) {
    return 'name 必须是非空字符串。'
  }
  return null
}

function isCanvasMatchPayload(value: unknown): value is CanvasMatchPayload {
  return (
    isPlainObject(value) &&
    typeof value.width === 'number' &&
    typeof value.height === 'number' &&
    (typeof value.presetKey === 'string' || value.presetKey === null) &&
    Object.keys(value).length === 3
  )
}

function isCanvasApplyPresetPayload(value: unknown): value is CanvasApplyPresetPayload {
  return isPlainObject(value) && typeof value.presetKey === 'string' && Object.keys(value).length === 1
}

function isCanvasApplySizePayload(value: unknown): value is CanvasApplySizePayload {
  return (
    isPlainObject(value) &&
    typeof value.width === 'number' &&
    typeof value.height === 'number' &&
    Object.keys(value).length === 2
  )
}

function validateCanvasMatchPayload(value: unknown): string | null {
  if (!isCanvasMatchPayload(value)) {
    return 'match.canvas 必须完整包含 width、height、presetKey。'
  }
  const widthError = validateProjectCanvasDimensions(value.width, value.height)
  if (widthError) {
    return widthError
  }
  return null
}

function resolveApplyCanvas(value: unknown): VideoResolution | string {
  if (isCanvasApplyPresetPayload(value)) {
    const preset = resolveProjectResolutionFromCanvas({ presetKey: value.presetKey })
    if (!preset) {
      return `不支持的 canvas.presetKey: ${value.presetKey}。`
    }
    return preset
  }

  if (isCanvasApplySizePayload(value)) {
    const dimensionsError = validateProjectCanvasDimensions(value.width, value.height)
    if (dimensionsError) {
      return dimensionsError
    }

    const resolution = resolveProjectResolutionFromCanvas({
      width: value.width,
      height: value.height,
    })
    if (!resolution) {
      return '无法解析目标画布尺寸。'
    }
    return resolution
  }

  return 'apply.canvas 只能传 presetKey，或同时传 width 和 height。'
}

function validateProjectInfoPatch(
  match: Record<string, any>,
  apply: Record<string, any>,
): { keys: ProjectInfoKey[] } | { error: string } {
  const matchKeys = normalizeTopLevelKeys(match)
  const applyKeys = normalizeTopLevelKeys(apply)

  if (!matchKeys || !applyKeys) {
    return { error: 'match 和 apply 至少需要包含 1 个受支持字段。' }
  }

  const sortedMatchKeys = [...matchKeys].sort()
  const sortedApplyKeys = [...applyKeys].sort()
  if (JSON.stringify(sortedMatchKeys) !== JSON.stringify(sortedApplyKeys)) {
    return { error: 'match 和 apply 的顶层 key 集合必须完全一致。' }
  }

  for (const key of matchKeys) {
    if (key === 'canvas') {
      const canvasError = validateCanvasMatchPayload(match.canvas)
      if (canvasError) {
        return { error: canvasError }
      }
      const resolvedCanvas = resolveApplyCanvas(apply.canvas)
      if (typeof resolvedCanvas === 'string') {
        return { error: resolvedCanvas }
      }
      continue
    }

    const matchError = validateNameValue(match[key], key)
    if (matchError) {
      return { error: `match.${matchError}` }
    }
    const applyError = validateNameValue(apply[key], key)
    if (applyError) {
      return { error: `apply.${applyError}` }
    }
  }

  return { keys: matchKeys }
}

function ensureMatch(current: ProjectInfoPayload, match: Record<string, any>, keys: ProjectInfoKey[]): string | null {
  for (const key of keys) {
    if (key === 'canvas') {
      const currentCanvas = current.canvas
      const matchCanvas = match.canvas as CanvasMatchPayload
      if (
        currentCanvas.width !== matchCanvas.width ||
        currentCanvas.height !== matchCanvas.height ||
        currentCanvas.presetKey !== matchCanvas.presetKey
      ) {
        return '工程信息的 canvas 当前值与 match 不一致。'
      }
      continue
    }

    if (current[key] !== match[key]) {
      return `工程信息的 ${key} 当前值与 match 不一致。`
    }
  }

  return null
}

function applyProjectInfoPatch(
  store: ReturnType<typeof useUnifiedStore>,
  apply: Record<string, any>,
  keys: ProjectInfoKey[],
): string | null {
  for (const key of keys) {
    if (key === 'name') {
      store.projectName = apply.name.trim()
      continue
    }

    if (key === 'description') {
      store.projectDescription = apply.description
      continue
    }

    const resolution = resolveApplyCanvas(apply.canvas)
    if (typeof resolution === 'string') {
      return resolution
    }
    store.setVideoResolution(resolution)
  }

  return null
}

function rollbackProjectInfo(
  store: ReturnType<typeof useUnifiedStore>,
  previous: ProjectInfoPayload,
): void {
  store.projectName = previous.name
  store.projectDescription = previous.description

  const previousResolution = resolveProjectResolutionFromCanvas({
    width: previous.canvas.width,
    height: previous.canvas.height,
  })
  if (previousResolution) {
    store.setVideoResolution(previousResolution)
  }
}

export async function executeModifyProjectInfo(args: Record<string, any>) {
  const { match, apply } = args

  if (!isPlainObject(match) || !isPlainObject(apply)) {
    return buildToolError(
      'modify_project_info',
      'invalid_arguments',
      'match 和 apply 都必须是对象。',
    )
  }

  const validation = validateProjectInfoPatch(match, apply)
  if ('error' in validation) {
    return buildToolError('modify_project_info', 'invalid_arguments', validation.error)
  }

  try {
    const store = useUnifiedStore()
    const before = getCurrentProjectInfo()

    const conflictError = ensureMatch(before, match, validation.keys)
    if (conflictError) {
      return buildToolError('modify_project_info', 'conflict', conflictError)
    }

    const applyError = applyProjectInfoPatch(store, apply, validation.keys)
    if (applyError) {
      return buildToolError('modify_project_info', 'invalid_arguments', applyError)
    }

    try {
      await store.saveCurrentProject({ configChanged: true })
    } catch (error) {
      rollbackProjectInfo(store, before)
      throw error
    }

    const after = getCurrentProjectInfo()
    return buildToolSuccess('modify_project_info', { before, after })
  } catch (error: any) {
    return buildToolError(
      'modify_project_info',
      'internal_error',
      error instanceof Error ? error.message : String(error),
    )
  }
}

export const modifyProjectInfoTool: ToolDefinition = {
  name: 'modify_project_info',
  execute: executeModifyProjectInfo,
} as ToolDefinition
