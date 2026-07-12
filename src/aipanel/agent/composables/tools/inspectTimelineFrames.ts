import { useUnifiedStore } from '@/core/unifiedStore'
import { framesToTimecode } from '@/core/utils/timeUtils'
import { computed, reactive } from 'vue'
import {
  FRAME_INSPECTION_MAX_FRAMES,
  normalizeInspectionTimecode,
  parseInspectionTimecode,
  runFrameInspection,
  type FrameInspectionPoint,
} from '@/aipanel/inspection/frameInspectionService'
import type { ToolDefinition, ToolExecutionContext } from '../core/toolTypes'
import { buildToolError, buildToolSuccess } from './utils/result'
import { registerToolCancellationHook, unregisterToolCancellationHook } from './cancellation'

const TOOL_NAME = 'inspect_timeline_frames'

type FrameInspectionStage = 'capturing' | 'uploading' | 'inspecting' | 'stopping'

export interface FrameInspectionExecutionState {
  toolCallId: string
  stage: FrameInspectionStage
  totalFrames: number
  uploadedFrames: number
  progress: number
  active: boolean
  canCancel: boolean
  cancelled: boolean
  messageKey: string
}

const activeExecutions = reactive<Record<string, FrameInspectionExecutionState>>({})

export function useFrameInspectionExecutionState(toolCallId: string) {
  return computed(() => activeExecutions[toolCallId] ?? null)
}

function startExecutionState(toolCallId: string, totalFrames: number): void {
  activeExecutions[toolCallId] = {
    toolCallId,
    stage: 'capturing',
    totalFrames,
    uploadedFrames: 0,
    progress: 5,
    active: true,
    canCancel: true,
    cancelled: false,
    messageKey: 'aiPanel.toolsState.inspectionCapturing',
  }
}

function updateExecutionState(
  toolCallId: string,
  patch: Partial<FrameInspectionExecutionState>,
): void {
  const current = activeExecutions[toolCallId]
  if (current) {
    Object.assign(current, patch)
  }
}

function finishExecutionState(toolCallId: string): void {
  delete activeExecutions[toolCallId]
  unregisterToolCancellationHook(TOOL_NAME, toolCallId)
}

function buildPoints(
  values: unknown,
  contentEndTimeFrames: number,
): FrameInspectionPoint[] | string {
  if (!Array.isArray(values) || values.length === 0) {
    return 'timecodes 必须是至少包含一个时间码的数组。'
  }
  if (values.length > FRAME_INSPECTION_MAX_FRAMES) {
    return `单次最多巡检 ${FRAME_INSPECTION_MAX_FRAMES} 帧。`
  }
  if (contentEndTimeFrames <= 0) {
    return '当前时间线为空，无法执行画面巡检。'
  }

  const points = new Map<string, FrameInspectionPoint>()
  for (const value of values) {
    if (typeof value !== 'string') {
      return 'timecodes 中的每一项必须是字符串。'
    }

    const timecode = normalizeInspectionTimecode(value)
    if (!timecode) {
      return 'timecodes 中不能包含空时间码。'
    }

    let frameNumber: number
    try {
      frameNumber = parseInspectionTimecode(timecode)
    } catch {
      return `无效时间码：${value}。时间码格式应为 HH:MM:SS+FF。`
    }

    if (frameNumber >= contentEndTimeFrames) {
      return `时间码 ${value} 超出当前时间线范围。`
    }

    points.set(timecode, { timecode, frameNumber })
  }

  return [...points.values()].sort((left, right) => left.frameNumber - right.frameNumber)
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export async function executeInspectTimelineFrames(
  args: Record<string, unknown>,
  context?: ToolExecutionContext,
) {
  const instruction = typeof args.instruction === 'string' ? args.instruction.trim() : ''
  if (!instruction) {
    return buildToolError(TOOL_NAME, 'invalid_arguments', 'instruction 必须是非空字符串。')
  }

  const unifiedStore = useUnifiedStore()
  const points = buildPoints(args.timecodes, unifiedStore.contentEndTimeFrames)
  if (typeof points === 'string') {
    return buildToolError(TOOL_NAME, 'invalid_arguments', points)
  }

  const toolCallId = context?.toolCallId
  const abortController = new AbortController()
  let cancelled = false
  if (toolCallId) {
    startExecutionState(toolCallId, points.length)
    registerToolCancellationHook(TOOL_NAME, toolCallId, () => {
      cancelled = true
      abortController.abort()
      updateExecutionState(toolCallId, {
        stage: 'stopping',
        active: false,
        canCancel: false,
        cancelled: true,
        messageKey: 'aiPanel.toolsState.inspectionStopping',
      })
    })
  }

  try {
    const result = await runFrameInspection({
      instruction,
      points,
      timelineItems: [...unifiedStore.timelineItems],
      tracks: unifiedStore.tracks.map((track) => ({
        id: track.id,
        isVisible: track.isVisible,
        isMuted: track.isMuted,
      })),
      getMediaItem: (id) => unifiedStore.getMediaItem(id),
      getAsset: (id) => unifiedStore.getAsset(id),
      videoResolution: {
        width: unifiedStore.videoResolution.width,
        height: unifiedStore.videoResolution.height,
      },
      signal: abortController.signal,
      onProgress: (progress) => {
        if (!toolCallId) return

        if (progress.stage === 'capturing') {
          updateExecutionState(toolCallId, {
            stage: 'capturing',
            progress: 5,
            messageKey: 'aiPanel.toolsState.inspectionCapturing',
          })
          return
        }

        if (progress.stage === 'captured') {
          updateExecutionState(toolCallId, {
            stage: 'uploading',
            progress: 30,
            messageKey: 'aiPanel.toolsState.inspectionUploading',
          })
          return
        }

        if (progress.stage === 'uploading') {
          const completedCount = progress.completedCount ?? 0
          const totalCount = progress.totalCount ?? points.length
          const fileProgress = progress.fileProgress ?? 0
          const ratio = (completedCount + fileProgress / 100) / Math.max(1, totalCount)
          updateExecutionState(toolCallId, {
            stage: 'uploading',
            uploadedFrames: completedCount,
            progress: 30 + Math.round(ratio * 45),
            messageKey: 'aiPanel.toolsState.inspectionUploading',
          })
          return
        }

        if (progress.stage === 'inspecting') {
          updateExecutionState(toolCallId, {
            stage: 'inspecting',
            uploadedFrames: points.length,
            progress: 82,
            messageKey: 'aiPanel.toolsState.inspectionInspecting',
          })
        }
      },
    })

    if (cancelled) {
      return buildToolError(TOOL_NAME, 'user_cancelled', '用户取消了本次画面巡检。')
    }

    return buildToolSuccess(
      TOOL_NAME,
      {
        instruction,
        inspectedTimecodes: points.map((point) => framesToTimecode(point.frameNumber)),
        model: result.response.model,
        answer: result.response.answer,
      },
      `已完成 ${points.length} 帧画面巡检。`,
    )
  } catch (error) {
    if (cancelled || isAbortError(error)) {
      return buildToolError(TOOL_NAME, 'user_cancelled', '用户取消了本次画面巡检。')
    }
    return buildToolError(
      TOOL_NAME,
      'internal_error',
      error instanceof Error ? error.message : String(error),
    )
  } finally {
    if (toolCallId) {
      finishExecutionState(toolCallId)
    }
  }
}

export const inspectTimelineFramesTool: ToolDefinition = {
  name: TOOL_NAME,
  execute: executeInspectTimelineFrames,
}
