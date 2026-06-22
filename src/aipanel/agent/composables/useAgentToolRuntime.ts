import { useUnifiedStore } from '@/core/unifiedStore'
import * as tools from './tools'

type AgentToolRuntimeReturn = ReturnType<typeof createAgentToolRuntime>

let agentToolRuntimeCache: AgentToolRuntimeReturn | null = null

function createAgentToolRuntime() {
  const unifiedStore = useUnifiedStore()

  /**
   * 获取被动注入的上下文信息
   * 包括项目信息、选中状态和播放头位置，自动附加到用户消息中
   */
  function getPassiveContext(): string {
    const parts: string[] = []

    try {
      const projectName = unifiedStore.projectName || '未命名项目'
      const videoResolution = unifiedStore.videoResolution
      const resolution = videoResolution
        ? `${videoResolution.width}x${videoResolution.height}${videoResolution.aspectRatio ? ` (${videoResolution.aspectRatio})` : ''}`
        : '未设置'

      parts.push(`[当前项目信息]`)
      parts.push(`- 项目名称: ${projectName}`)
      parts.push(`- 视频分辨率: ${resolution}`)
    } catch (error: any) {
      console.error('获取项目信息失败:', error)
      parts.push('[当前项目信息]')
      parts.push('- 项目信息获取失败')
    }

    try {
      const hasTimelineSelection = unifiedStore.hasSelection
      const hasLibraryAssetSelection = unifiedStore.hasLibraryAssetSelection

      if (hasTimelineSelection || hasLibraryAssetSelection) {
        parts.push('')
        parts.push('[当前选中状态]')

        if (hasTimelineSelection) {
          const selectedIds = Array.from(unifiedStore.selectedTimelineSelectionIds)
          const count = selectedIds.length

          if (count === 1) {
            const selectedItem = unifiedStore.getSelectedClipTimelineItem()
            const selectedTransition = unifiedStore.getSelectedTransitionOverlay()
            if (selectedItem) {
              parts.push(`- 时间轴选中: 1 个项目`)
              parts.push(`  - ID: ${selectedItem.id}`)
              parts.push(`  - 媒体类型: ${selectedItem.mediaType}`)
              if (selectedItem.trackId) {
                parts.push(`  - 轨道ID: ${selectedItem.trackId}`)
              }
              parts.push(`  - 时间范围: ${selectedItem.timeRange.timelineStartTime / 1000000}s - ${selectedItem.timeRange.timelineEndTime / 1000000}s`)
              if (selectedItem.mediaItemId) {
                parts.push(`  - 媒体项ID: ${selectedItem.mediaItemId}`)
              }
            } else if (selectedTransition) {
              parts.push(`- 时间轴选中: 1 个转场`)
              parts.push(`  - ID: ${selectedTransition.selectionId}`)
              parts.push(`  - 源片段ID: ${selectedTransition.sourceItemId}`)
              parts.push(`  - 轨道ID: ${selectedTransition.trackId}`)
            }
          } else {
            parts.push(`- 时间轴选中: ${count} 个项目`)
            parts.push(`  - ID列表: ${selectedIds.join(', ')}`)
          }
        }

        if (hasLibraryAssetSelection) {
          const selectedMediaIds = Array.from(unifiedStore.selectedLibraryAssetIds)
          const mediaCount = selectedMediaIds.length
          parts.push(`- 媒体库选中: ${mediaCount} 个项目`)
          if (mediaCount === 1) {
            const mediaId = selectedMediaIds[0]
            if (mediaId) {
              parts.push(`  - ID: ${mediaId}`)
              const asset = unifiedStore.getAsset(mediaId)
              if (asset) {
                parts.push(`  - 名称: ${asset.name}`)
                parts.push(`  - 类型: ${asset.assetKind === 'effect-template' ? asset.effectType : asset.mediaType}`)
              }
            }
          } else {
            parts.push(`  - ID列表: ${selectedMediaIds.join(', ')}`)
          }
        }
      }
    } catch (error: any) {
      console.error('获取选中状态失败:', error)
    }

    try {
      const currentFrame = unifiedStore.currentFrame
      parts.push('')
      parts.push('[播放头位置]')
      parts.push(`- 当前帧: ${currentFrame}`)
    } catch (error: any) {
      console.error('获取播放头位置失败:', error)
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
