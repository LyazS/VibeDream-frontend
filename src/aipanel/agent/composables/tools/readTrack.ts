/**
 * read_track 工具实现
 * 读取轨道详细状态信息
 */

import { useUnifiedStore } from '@/core/unifiedStore'
import { getTimelineItemsByTrack } from '@/core/utils/timelineSearchUtils'
import { framesToTimecode, timecodeToFrames } from '@/core/utils/timeUtils'
import type { ToolDefinition } from '../core/toolTypes'

/**
 * 轨道上的时间轴项目信息
 */
interface TrackItemInfo {
  /** 时间轴项目ID */
  id: string
  /** 关联的素材ID */
  mediaItemId: string
  /** 时间轴时间范围 */
  timeRange: string // "00:00:00.00 - 00:00:10.00"
}

/**
 * 时间码转帧数
 */
function timecodeToFramesSafe(timecode: string): number | null {
  try {
    return timecodeToFrames(timecode)
  } catch {
    return null
  }
}

/**
 * read_track 工具执行函数
 *
 * 获取指定轨道的详细状态信息，包括可见/静音状态，以及可配置的轨道上时间轴项目列表。
 *
 * @param args - 工具参数
 * @param args.trackId - 轨道ID
 * @param args.includeItems - 是否包含轨道上的时间轴项目列表（默认true）
 * @param args.startTime - 筛选开始时间（时间码格式），只返回此时间之后的片段
 * @param args.endTime - 筛选结束时间（时间码格式），只返回此时间之前的片段
 * @returns 格式化的轨道详细信息文本
 */
export async function executeReadTrack(args: Record<string, any>): Promise<string> {
  const { trackId, includeItems = true, startTime, endTime } = args

  // 1. 参数验证
  if (!trackId || typeof trackId !== 'string') {
    return 'Error: trackId is required and must be a string'
  }

  try {
    const store = useUnifiedStore()
    const track = store.getTrack(trackId)

    if (!track) {
      return `未找到 ID "${trackId}" 的轨道。请使用 list_tracks 查看正确的轨道 ID。`
    }

    // 2. 构建轨道基本信息
    const lines: string[] = []
    lines.push(`=== 轨道详情 ===`)
    lines.push(`ID: ${track.id}`)
    lines.push(`名称: ${track.name}`)
    lines.push(`类型: ${track.type}`)
    lines.push(`可见: ${track.isVisible ? '是' : '否'}`)
    lines.push(`静音: ${track.isMuted ? '是' : '否'}`)

    // 3. 获取轨道上的时间轴项目（如果需要）
    if (includeItems) {
      const allTrackItems = getTimelineItemsByTrack(trackId, store.timelineItems || [])

      // 应用时间范围过滤
      let filteredItems = allTrackItems
      if (startTime || endTime) {
        const startFrames = startTime ? timecodeToFramesSafe(startTime) : 0
        const endFrames = endTime ? timecodeToFramesSafe(endTime) : Infinity

        filteredItems = allTrackItems.filter((item) => {
          const itemStart = item.timeRange.timelineStartTime
          const itemEnd = item.timeRange.timelineEndTime

          // 检查是否有重叠：两个时间范围重叠的条件是开始时间小于对方的结束时间，且结束时间大于对方的开始时间
          return startFrames! < itemEnd && endFrames! > itemStart
        })
      }

      lines.push('')
      lines.push(`=== 时间轴项目 (${filteredItems.length}个) ===`)

      if (filteredItems.length === 0) {
        lines.push('(轨道上没有时间轴项目)')
      } else {
        for (const item of filteredItems) {
          const timeRangeStr = `${framesToTimecode(item.timeRange.timelineStartTime)} - ${framesToTimecode(item.timeRange.timelineEndTime)}`

          lines.push(`[ID: ${item.id}] ${timeRangeStr}`)
        }
      }
    }

    return lines.join('\n')
  } catch (error: any) {
    return `Error reading track: ${error.message}`
  }
}

/**
 * read_track 工具定义
 * 供 index.ts 注册使用
 */
export const readTrackTool: ToolDefinition = {
  name: 'read_track',
  execute: executeReadTrack
} as ToolDefinition
