/**
 * read_track 工具实现
 * 读取轨道上的时间轴项目列表，返回 XML
 */

import { useUnifiedStore } from '@/core/unifiedStore'
import { getTimelineItemsByTrack } from '@/core/utils/timelineSearchUtils'
import { framesToTimecode } from '@/core/utils/timeUtils'
import type { ToolDefinition } from '../core/toolTypes'
import { isValidAgentToolTimecode, parseAgentToolTimecode } from './utils/timecode'
import { buildXmlAttributes, escapeXmlText } from './utils/xml'

/**
 * 轨道上的时间轴项目信息
 */
interface TrackItemInfo {
  /** 时间轴项目ID */
  id: string
  /** 时间轴开始时间 */
  start: string
  /** 时间轴结束时间 */
  end: string
  /** 媒体类型 */
  type: string
}

/**
 * read_track 工具执行函数
 *
 * 获取指定轨道上的时间轴项目列表。
 *
 * @param args - 工具参数
 * @param args.trackId - 轨道ID
 * @param args.startTime - 筛选开始时间（时间码格式），只返回此时间之后的片段
 * @param args.endTime - 筛选结束时间（时间码格式），只返回此时间之前的片段
 * @returns XML 格式的轨道项目列表
 */
export async function executeReadTrack(args: Record<string, any>): Promise<string> {
  const { trackId, startTime, endTime } = args

  if (!trackId || typeof trackId !== 'string') {
    return '<error>trackId 是必填项，且必须是字符串。</error>'
  }

  try {
    const store = useUnifiedStore()
    const track = store.getTrack(trackId)

    if (!track) {
      return `<error>未找到 ID "${escapeXmlText(trackId)}" 的轨道。请使用 list_tracks 查看正确的轨道 ID。</error>`
    }

    const allTrackItems = getTimelineItemsByTrack(trackId, store.timelineItems || [])

    let filteredItems = allTrackItems
    if (startTime || endTime) {
      if ((startTime && !isValidAgentToolTimecode(startTime)) || (endTime && !isValidAgentToolTimecode(endTime))) {
        return '<error>startTime 或 endTime 不是合法的时间码，格式应为 HH:MM:SS+FF。</error>'
      }

      const startFrames = startTime ? parseAgentToolTimecode(startTime) : 0
      const endFrames = endTime ? parseAgentToolTimecode(endTime) : Infinity

      filteredItems = allTrackItems.filter((item) => {
        const itemStart = item.timeRange.timelineStartTime
        const itemEnd = item.timeRange.timelineEndTime
        return startFrames < itemEnd && endFrames > itemStart
      })
    }

    const itemInfos: TrackItemInfo[] = filteredItems.map((item) => ({
      id: item.id,
      start: framesToTimecode(item.timeRange.timelineStartTime),
      end: framesToTimecode(item.timeRange.timelineEndTime),
      type: item.mediaType,
    }))

    const rootAttributes = buildXmlAttributes([
      ['track_id', trackId],
      ['total', itemInfos.length],
      ['filter_start', startTime],
      ['filter_end', endTime],
    ])

    if (itemInfos.length === 0) {
      return `<read_track ${rootAttributes} />`
    }

    const lines: string[] = [`<read_track ${rootAttributes}>`]
    for (const item of itemInfos) {
      lines.push(
        `  <item ${buildXmlAttributes([
          ['id', item.id],
          ['start', item.start],
          ['end', item.end],
          ['type', item.type],
        ])} />`,
      )
    }
    lines.push('</read_track>')

    return lines.join('\n')
  } catch (error: any) {
    return `<error>${escapeXmlText(error.message)}</error>`
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
