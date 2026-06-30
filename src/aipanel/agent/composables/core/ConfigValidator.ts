/**
 * 配置验证器 - 验证操作配置的合法性
 * 确保所有操作参数符合系统要求
 */

import type { BaseOperationConfig, ValidationError } from './types'

export class ConfigValidator {
  /**
   * 验证操作配置数组
   */
  validateOperations(operations: BaseOperationConfig[]): ValidationError[] {
    const errors: ValidationError[] = []

    for (const op of operations) {
      try {
        this.validateSingleOperation(op)
      } catch (error: any) {
        errors.push({ operation: op, error: error.message })
      }
    }

    return errors
  }

  /**
   * 验证单个操作
   */
  private validateSingleOperation(op: BaseOperationConfig) {
    if (!op.type || typeof op.type !== 'string') {
      throw new Error('操作类型不能为空且必须是字符串')
    }

    if (!op.params || typeof op.params !== 'object') {
      throw new Error('操作参数不能为空且必须是对象')
    }

    switch (op.type) {
      case 'addMediaToTimeline':
        this.validateAddMediaToTimeline(op.params)
        break
      case 'addTextToTimeline':
        this.validateAddTextToTimeline(op.params)
        break
      case 'rmTimelineItem':
        this.validateRmTimelineItem(op.params)
        break
      case 'mvTimelineItem':
        this.validateMvTimelineItem(op.params)
        break
      case 'resizeTimelineItem':
        this.validateResizeTimelineItem(op.params)
        break
      case 'addTrack':
        this.validateAddTrack(op.params)
        break
      case 'removeTrack':
        this.validateRemoveTrack(op.params)
        break
      case 'renameTrack':
        this.validateRenameTrack(op.params)
        break
      case 'moveTrack':
        this.validateMoveTrack(op.params)
        break
      case 'toggleTrackMute':
        this.validateToggleTrackMute(op.params)
        break
      case 'toggleTrackVisibility':
        this.validateToggleTrackVisibility(op.params)
        break
      case 'toggleProportionalScale':
        this.validateToggleProportionalScale(op.params)
        break
      case 'updateTimelineItem':
        this.validateUpdateTimelineItem(op.params)
        break
      case 'splitTimelineItem':
        this.validateSplitTimelineItem(op.params)
        break
      default:
        throw new Error(`不支持的操作类型: ${op.type}`)
    }
  }

  /**
   * 验证时间码格式 (HH:MM:SS+FF 或 MM:SS+FF)
   * 当省略小时时，默认为 0
   */
  private validateTimecode(timecode: string): void {
    if (typeof timecode !== 'string') {
      throw new Error('时间码必须是字符串')
    }

    // 支持两种格式：HH:MM:SS+FF 或 MM:SS+FF
    const fullFormatRegex = /^(\d{2}):(\d{2}):(\d{2})\+(\d{2})$/
    const shortFormatRegex = /^(\d{2}):(\d{2})\+(\d{2})$/

    let h = 0, m: number, s: number

    if (fullFormatRegex.test(timecode)) {
      // 完整格式 HH:MM:SS+FF
      const [, hours, minutes, seconds] = timecode.match(fullFormatRegex)!
      h = parseInt(hours, 10)
      m = parseInt(minutes, 10)
      s = parseInt(seconds, 10)
    } else if (shortFormatRegex.test(timecode)) {
      // 简短格式 MM:SS+FF，小时默认为 0
      const [, minutes, seconds] = timecode.match(shortFormatRegex)!
      m = parseInt(minutes, 10)
      s = parseInt(seconds, 10)
    } else {
      throw new Error(`无效的时间码格式: ${timecode}，应为 HH:MM:SS+FF 或 MM:SS+FF 格式`)
    }

    if (h < 0 || m < 0 || m > 59 || s < 0 || s > 59) {
      throw new Error(`无效的时间码值: ${timecode}`)
    }
  }

  /**
   * 验证添加媒体到时间轴操作
   */
  private validateAddMediaToTimeline(params: any): void {
    if (!params.mediaItemId || typeof params.mediaItemId !== 'string') {
      throw new Error('mediaItemId 不能为空且必须是字符串')
    }

    if (!params.trackId || typeof params.trackId !== 'string') {
      throw new Error('trackId 不能为空且必须是字符串')
    }

    const requiredParams = ['timelineStart', 'timelineEnd', 'clipStart', 'clipEnd']
    for (const param of requiredParams) {
      if (!params[param]) {
        throw new Error(`${param} 是必需参数`)
      }
      if (typeof params[param] !== 'string') {
        throw new Error(`${param} 必须是字符串`)
      }
      this.validateTimecode(params[param])
    }
  }

  /**
   * 验证添加文本到时间轴操作
   */
  private validateAddTextToTimeline(params: any): void {
    if (!params.text || typeof params.text !== 'string') {
      throw new Error('text 不能为空且必须是字符串')
    }

    if (!params.trackId || typeof params.trackId !== 'string') {
      throw new Error('trackId 不能为空且必须是字符串')
    }

    if (!params.timelineStart || typeof params.timelineStart !== 'string') {
      throw new Error('timelineStart 不能为空且必须是字符串')
    }

    if (!params.duration || typeof params.duration !== 'string') {
      throw new Error('duration 不能为空且必须是字符串')
    }

    this.validateTimecode(params.timelineStart)
    this.validateTimecode(params.duration)
  }

  /**
   * 验证删除时间轴项目操作
   */
  private validateRmTimelineItem(params: any): void {
    if (!params.itemId || typeof params.itemId !== 'string') {
      throw new Error('itemId 不能为空且必须是字符串')
    }
  }

  /**
   * 验证移动时间轴项目操作
   */
  private validateMvTimelineItem(params: any): void {
    if (!params.itemId || typeof params.itemId !== 'string') {
      throw new Error('itemId 不能为空且必须是字符串')
    }

    if (!params.newTimelineStart || typeof params.newTimelineStart !== 'string') {
      throw new Error('newTimelineStart 不能为空且必须是字符串')
    }

    this.validateTimecode(params.newTimelineStart)

    if (params.newTrackId !== undefined && typeof params.newTrackId !== 'string') {
      throw new Error('newTrackId 必须是字符串')
    }
  }

  /**
   * 验证调整时间轴项目大小操作
   */
  private validateResizeTimelineItem(params: any): void {
    if (!params.itemId || typeof params.itemId !== 'string') {
      throw new Error('itemId 不能为空且必须是字符串')
    }

    // 验证所有 4 个必需参数
    const requiredParams = ['timelineStart', 'timelineEnd', 'clipStart', 'clipEnd']
    for (const param of requiredParams) {
      if (!params[param]) {
        throw new Error(`${param} 是必需参数`)
      }
      if (typeof params[param] !== 'string') {
        throw new Error(`${param} 必须是字符串`)
      }
      this.validateTimecode(params[param])
    }
  }

  /**
   * 验证添加轨道操作
   */
  private validateAddTrack(params: any): void {
    if (!params.trackType || typeof params.trackType !== 'string') {
      throw new Error('trackType 不能为空且必须是字符串')
    }

    const validTypes = ['video', 'audio', 'text']
    if (!validTypes.includes(params.trackType)) {
      throw new Error(`trackType 必须是以下值之一: ${validTypes.join(', ')}`)
    }

    if (params.position !== undefined) {
      const numPos = Number(params.position)
      if (isNaN(numPos) || numPos < 0) {
        throw new Error('position 必须是非负数')
      }
    }
  }

  /**
   * 验证删除轨道操作
   */
  private validateRemoveTrack(params: any): void {
    if (!params.trackId || typeof params.trackId !== 'string') {
      throw new Error('trackId 不能为空且必须是字符串')
    }
  }

  /**
   * 验证重命名轨道操作
   */
  private validateRenameTrack(params: any): void {
    if (!params.trackId || typeof params.trackId !== 'string') {
      throw new Error('trackId 不能为空且必须是字符串')
    }

    if (!params.newName || typeof params.newName !== 'string') {
      throw new Error('newName 不能为空且必须是字符串')
    }

    if (!params.newName.trim()) {
      throw new Error('newName 不能为空字符串')
    }
  }

  /**
   * 验证移动轨道操作
   */
  private validateMoveTrack(params: any): void {
    if (!params.trackId || typeof params.trackId !== 'string') {
      throw new Error('trackId 不能为空且必须是字符串')
    }

    if (params.newPosition === undefined || typeof params.newPosition !== 'number') {
      throw new Error('newPosition 不能为空且必须是数字')
    }

    if (params.newPosition < 0) {
      throw new Error('newPosition 必须是非负数')
    }
  }

  /**
   * 验证切换轨道静音状态操作
   */
  private validateToggleTrackMute(params: any): void {
    if (!params.trackId || typeof params.trackId !== 'string') {
      throw new Error('trackId 不能为空且必须是字符串')
    }

    if (params.targetMuteState !== undefined && typeof params.targetMuteState !== 'boolean') {
      throw new Error('targetMuteState 必须是布尔值')
    }
  }

  /**
   * 验证切换轨道可见性操作
   */
  private validateToggleTrackVisibility(params: any): void {
    if (!params.trackId || typeof params.trackId !== 'string') {
      throw new Error('trackId 不能为空且必须是字符串')
    }

    if (params.targetVisible !== undefined && typeof params.targetVisible !== 'boolean') {
      throw new Error('targetVisible 必须是布尔值')
    }
  }

  /**
   * 验证切换等比缩放操作
   */
  private validateToggleProportionalScale(params: any): void {
    if (!params.itemId || typeof params.itemId !== 'string') {
      throw new Error('itemId 不能为空且必须是字符串')
    }

    if (params.enabled !== undefined && typeof params.enabled !== 'boolean') {
      throw new Error('enabled 必须是布尔值')
    }
  }

  /**
   * 验证更新时间轴项目属性操作
   */
  private validateUpdateTimelineItem(params: any): void {
    if (!params.itemId || typeof params.itemId !== 'string') {
      throw new Error('itemId 不能为空且必须是字符串')
    }

    // 检查是否至少提供了一个要更新的属性
    const hasPropertyToUpdate =
      params.x !== undefined ||
      params.y !== undefined ||
      params.width !== undefined ||
      params.height !== undefined ||
      params.rotation !== undefined ||
      params.blendIntensity !== undefined ||
      params.volume !== undefined ||
      params.isMuted !== undefined ||
      params.playbackRate !== undefined

    if (!hasPropertyToUpdate) {
      throw new Error('必须提供至少一个要更新的属性')
    }

    // 宽高互斥验证
    const hasWidth = params.width !== undefined
    const hasHeight = params.height !== undefined

    if (hasWidth && hasHeight) {
      throw new Error(
        'width 和 height 不能同时提供。' +
        '只提供一个，另一个会根据原始宽高比自动计算。\n' +
        '正确用法：updateTimelineItem(id, { width: 800 })\n' +
        '或：updateTimelineItem(id, { height: 600 })'
      )
    }

    // 验证数值类型的属性
    if (params.x !== undefined && typeof params.x !== 'number') {
      throw new Error('x 必须是数字')
    }

    if (params.y !== undefined && typeof params.y !== 'number') {
      throw new Error('y 必须是数字')
    }

    if (hasWidth && typeof params.width !== 'number') {
      throw new Error('width 必须是数字')
    }

    if (hasWidth && params.width <= 0) {
      throw new Error('width 必须大于 0')
    }

    if (hasHeight && typeof params.height !== 'number') {
      throw new Error('height 必须是数字')
    }

    if (hasHeight && params.height <= 0) {
      throw new Error('height 必须大于 0')
    }

    if (params.rotation !== undefined && typeof params.rotation !== 'number') {
      throw new Error('rotation 必须是数字')
    }

    if (params.blendIntensity !== undefined && (typeof params.blendIntensity !== 'number' || params.blendIntensity < 0 || params.blendIntensity > 1)) {
      throw new Error('blendIntensity 必须是 0-1 之间的数字')
    }

    if (params.volume !== undefined && (typeof params.volume !== 'number' || params.volume < 0 || params.volume > 1)) {
      throw new Error('volume 必须是 0-1 之间的数字')
    }

    if (params.isMuted !== undefined && typeof params.isMuted !== 'boolean') {
      throw new Error('isMuted 必须是布尔值')
    }

    if (params.playbackRate !== undefined && (typeof params.playbackRate !== 'number' || params.playbackRate <= 0)) {
      throw new Error('playbackRate 必须是正数')
    }
  }

  /**
   * 验证分割时间轴项目操作
   */
  private validateSplitTimelineItem(params: any): void {
    if (!params.itemId || typeof params.itemId !== 'string') {
      throw new Error('itemId 不能为空且必须是字符串')
    }

    if (!params.splitTimecodes || !Array.isArray(params.splitTimecodes)) {
      throw new Error('splitTimecodes 不能为空且必须是数组')
    }

    if (params.splitTimecodes.length === 0) {
      throw new Error('splitTimecodes 必须包含至少一个时间点')
    }

    // 验证每个时间码格式
    for (let i = 0; i < params.splitTimecodes.length; i++) {
      const timecode = params.splitTimecodes[i]
      if (typeof timecode !== 'string') {
        throw new Error(`splitTimecodes[${i}] 必须是字符串`)
      }
      this.validateTimecode(timecode)
    }

    // 验证时间码是否按时间顺序排列
    // 由于我们只有时间码字符串，这里只做基本验证，不进行实际值比较
    // 值的比较会在 CommandFactory 中进行（转换为帧数后）
  }
}
