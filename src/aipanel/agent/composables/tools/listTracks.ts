/**
 * list_tracks 工具实现
 * 列出时间轴上所有轨道的基本信息，返回 XML
 */

import { useUnifiedStore } from '@/core/unifiedStore'
import { getTimelineItemsByTrack } from '@/core/utils/timelineSearchUtils'
import type { ToolDefinition } from '../core/toolTypes'
import { buildXmlAttributes, escapeXmlText } from './utils/xml'

/**
 * 轨道基本信息接口
 */
interface TrackBasicInfo {
  /** 轨道ID */
  id: string
  /** 轨道名称 */
  name: string
  /** 轨道类型 */
  type: 'video' | 'audio' | 'text'
  /** 轨道顺序 */
  index: number
  /** 是否可见 */
  visible: boolean
  /** 是否静音 */
  muted: boolean
  /** 轨道上的时间轴项目数 */
  itemCount: number
}

/**
 * list_tracks 工具执行函数
 *
 * 获取时间轴上所有轨道的基本信息（id、名字、类型），用于快速浏览和筛选轨道。
 *
 * @returns XML 格式的轨道基本信息
 */
export async function executeListTracks(args: Record<string, any>): Promise<string> {
  try {
    void args
    const store = useUnifiedStore()
    const tracks = store.tracks || []
    const timelineItems = store.timelineItems || []

    if (tracks.length === 0) {
      return '<list_tracks total="0" />'
    }

    const trackInfos: TrackBasicInfo[] = tracks.map((track, index) => ({
      id: track.id,
      name: track.name,
      type: track.type as 'video' | 'audio' | 'text',
      index,
      visible: track.isVisible,
      muted: track.isMuted,
      itemCount: getTimelineItemsByTrack(track.id, timelineItems).length,
    }))

    const lines: string[] = [`<list_tracks total="${trackInfos.length}">`]
    for (const track of trackInfos) {
      lines.push(
        `  <track ${buildXmlAttributes([
          ['id', track.id],
          ['name', track.name],
          ['type', track.type],
          ['index', track.index],
          ['visible', track.visible],
          ['muted', track.muted],
          ['item_count', track.itemCount],
        ])} />`,
      )
    }
    lines.push('</list_tracks>')

    return lines.join('\n')
  } catch (error: any) {
    return `<error>${escapeXmlText(error.message)}</error>`
  }
}

/**
 * list_tracks 工具定义
 * 供 index.ts 注册使用
 */
export const listTracksTool: ToolDefinition = {
  name: 'list_tracks',
  execute: executeListTracks
} as ToolDefinition
