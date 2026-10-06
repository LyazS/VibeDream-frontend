/** @deprecated 旧会话工具编排，新 Agent 将通过独立 ToolRuntime 复用工具。 */
import { unref } from 'vue'
import { useUnifiedStore } from '@/core/unifiedStore'
import * as tools from './tools'
import { calculateVisibleFrameRange } from '@/core/utils/timelineScaleUtils'
import { framesToTimecode } from '@/core/utils/timeUtils'
import {
  buildCanonicalDirectoryPath,
  getDirectoryParentPath,
} from './tools/libraryPath'

type AgentToolRuntimeReturn = ReturnType<typeof createAgentToolRuntime>

let agentToolRuntimeCache: AgentToolRuntimeReturn | null = null

function createAgentToolRuntime() {
  const unifiedStore = useUnifiedStore()

  function getPassiveContext(): string {
    const parts: string[] = []

    try {
      const currentDirectory = unref(unifiedStore.currentDir)
      if (currentDirectory) {
        const currentPath = buildCanonicalDirectoryPath(currentDirectory.id)
        if (currentPath) {
          parts.push('[当前素材库目录] ' + currentPath)
        }
      }

      const selectedLibraryItemIds = Array.from(unifiedStore.selectedLibraryAssetIds)
      if (selectedLibraryItemIds.length > 0) {
        parts.push('[当前选中素材库项目]')
        selectedLibraryItemIds.forEach((itemId) => {
          const directory = unifiedStore.getDirectory(itemId)
          if (directory) {
            const path = buildCanonicalDirectoryPath(directory.id)
            const parentPath = getDirectoryParentPath(directory)
            parts.push(
              '- type: directory; name: ' +
                directory.name +
                '; path: ' +
                (path || '') +
                '; parentPath: ' +
                (parentPath || 'null'),
            )
            return
          }

          const media = unifiedStore.getMediaItem(itemId)
          const parentDirectoryId = unifiedStore.getAssetDirectoryId(itemId)
          const parentPath = parentDirectoryId
            ? buildCanonicalDirectoryPath(parentDirectoryId)
            : null
          if (media) {
            parts.push(
              '- type: media; mediaId: ' +
                media.id +
                '; name: ' +
                media.name +
                '; parentPath: ' +
                (parentPath || 'null'),
            )
            return
          }

          parts.push('- type: unknown; id: ' + itemId)
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
    } catch (error: unknown) {
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
    } catch (error: unknown) {
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
