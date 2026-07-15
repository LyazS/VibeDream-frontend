import { useUnifiedStore } from '@/core/unifiedStore'
import * as tools from './tools'
import { calculateVisibleFrameRange } from '@/core/utils/timelineScaleUtils'
import { framesToTimecode } from '@/core/utils/timeUtils'

type AgentToolRuntimeReturn = ReturnType<typeof createAgentToolRuntime>

let agentToolRuntimeCache: AgentToolRuntimeReturn | null = null

function createAgentToolRuntime() {
  const unifiedStore = useUnifiedStore()

  function getPassiveContext(): string {
    const parts: string[] = []

    try {
      const selectedMediaIds = Array.from(unifiedStore.selectedLibraryAssetIds)
      if (selectedMediaIds.length > 0) {
        parts.push('[当前选中素材media]')
        selectedMediaIds.forEach((mediaId) => {
          parts.push(`- ID: ${mediaId}`)
        })
      }

      const selectedClipIds = Array.from(unifiedStore.selectedClipTimelineItemIds)
      if (selectedClipIds.length > 0) {
        if (parts.length > 0) {
          parts.push('')
        }
        parts.push('[当前选中时间轴 Clip]')
        selectedClipIds.forEach((clipId) => {
          parts.push(`- ID: ${clipId}`)
        })
      }
    } catch (error: any) {
      console.error('获取选中状态失败:', error)
    }

    try {
      const currentFrame = unifiedStore.currentFrame
      if (parts.length > 0) {
        parts.push('')
      }
      parts.push(`[播放头当前位置] ${framesToTimecode(currentFrame)}`)

      const { startFrames, endFrames } = calculateVisibleFrameRange(
        unifiedStore.TimelineContentWidth,
        unifiedStore.totalDurationFrames,
        unifiedStore.zoomLevel,
        unifiedStore.scrollOffset,
        unifiedStore.maxVisibleDurationFrames,
      )
      parts.push(
        `[时间轴当前可视范围] ${framesToTimecode(startFrames)} ～ ${framesToTimecode(endFrames)}`,
      )
    } catch (error: any) {
      console.error('获取播放头或可视范围失败:', error)
    }

    return parts.join('\n')
  }

  return {
    executeTool: tools.executeTool,
    hasTool: tools.hasTool,
    getTool: tools.getTool,
    listTools: tools.listTools,
    getPassiveContext,
  }
}

export function useAgentToolRuntime() {
  if (!agentToolRuntimeCache) {
    agentToolRuntimeCache = createAgentToolRuntime()
  }
  return agentToolRuntimeCache
}
