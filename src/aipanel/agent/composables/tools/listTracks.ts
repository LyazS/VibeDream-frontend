/**
 * list_tracks 工具实现
 * 列出时间轴上所有轨道的基本信息
 */

import { useUnifiedStore } from '@/core/unifiedStore'
import type { ToolDefinition } from '../core/toolTypes'

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
}

/**
 * list_tracks 工具执行函数
 *
 * 获取时间轴上所有轨道的基本信息（id、名字、类型），用于快速浏览和筛选轨道。
 *
 * @returns 格式化的轨道基本信息文本
 */
export async function executeListTracks(args: Record<string, any>): Promise<string> {
  try {
    const store = useUnifiedStore()
    const tracks = store.tracks || []

    if (tracks.length === 0) {
      return '当前时间轴没有轨道'
    }

    // 构建轨道信息列表
    const trackInfos: TrackBasicInfo[] = tracks.map((track) => ({
      id: track.id,
      name: track.name,
      type: track.type as 'video' | 'audio' | 'text',
    }))

    // 格式化输出
    const lines: string[] = []
    lines.push(`=== 轨道列表 (${trackInfos.length}个) ===`)
    lines.push('')

    for (const track of trackInfos) {
      const typeLabel = {
        video: '视频',
        audio: '音频',
        text: '文字',
      }[track.type]

      lines.push(`[ID: ${track.id}]`)
      lines.push(`  名称: ${track.name}`)
      lines.push(`  类型: ${typeLabel}`)
      lines.push('')
    }

    return lines.join('\n')
  } catch (error: any) {
    return `Error reading tracks: ${error.message}`
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
