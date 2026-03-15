// 脚本执行Worker - 在沙箱环境中执行用户代码
import { timecodeToFrames, framesToTimecode } from '@/core/utils/timeUtils'

let operations: any[] = []

// 保存原始的console方法
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
}

// 日志数组
const logs: any[] = []

// 重写console方法以捕获输出
console.log = (...args: any[]) => {
  const message = args.map((arg) => String(arg)).join(' ')
  logs.push({
    type: 'log',
    message,
  })
  originalConsole.log(...args)
}

console.info = (...args: any[]) => {
  const message = args.map((arg) => String(arg)).join(' ')
  logs.push({
    type: 'info',
    message,
  })
  originalConsole.info(...args)
}

console.warn = (...args: any[]) => {
  const message = args.map((arg) => String(arg)).join(' ')
  logs.push({
    type: 'warn',
    message,
  })
  originalConsole.warn(...args)
}

console.error = (...args: any[]) => {
  const message = args.map((arg) => String(arg)).join(' ')
  logs.push({
    type: 'error',
    message,
  })
  originalConsole.error(...args)
}

console.debug = (...args: any[]) => {
  const message = args.map((arg) => String(arg)).join(' ')
  logs.push({
    type: 'debug',
    message,
  })
  originalConsole.debug(...args)
}

// 构建API对象 - 只保留添加时间轴项目功能
const buildAPI = () => {
  return {
    // === 时间轴操作 ===

    addMediaToTimeline: (mediaItemId: string, trackId: string, position: string) => {
      const result = { type: 'addMediaToTimeline', params: { mediaItemId, trackId, position } }
      operations.push(result)
      return result
    },

    addTextToTimeline: (text: string, trackId: string, position: string, duration: string) => {
      const result = { type: 'addTextToTimeline', params: { text, trackId, position, duration } }
      operations.push(result)
      return result
    },

    rmTimelineItem: (itemId: string) => {
      const result = { type: 'rmTimelineItem', params: { itemId } }
      operations.push(result)
      return result
    },

    mvTimelineItem: (itemId: string, newPosition: string, newTrackId?: string) => {
      const params: any = { itemId, newPosition }
      if (newTrackId !== undefined) {
        params.newTrackId = newTrackId
      }
      const result = { type: 'mvTimelineItem', params }
      operations.push(result)
      return result
    },

    resizeTimelineItem: (itemId: string, newStartTime?: string, newEndTime?: string) => {
      const params: any = { itemId }
      if (newStartTime !== undefined) params.newStartTime = newStartTime
      if (newEndTime !== undefined) params.newEndTime = newEndTime
      const result = { type: 'resizeTimelineItem', params }
      operations.push(result)
      return result
    },

    // === 轨道操作 ===

    addTrack: (trackType: 'video' | 'audio' | 'text', position?: number) => {
      const params: any = { trackType }
      if (position !== undefined) params.position = position
      const result = { type: 'addTrack', params }
      operations.push(result)
      return result
    },

    removeTrack: (trackId: string) => {
      const result = { type: 'removeTrack', params: { trackId } }
      operations.push(result)
      return result
    },

    renameTrack: (trackId: string, newName: string) => {
      const result = { type: 'renameTrack', params: { trackId, newName } }
      operations.push(result)
      return result
    },

    moveTrack: (trackId: string, newPosition: number) => {
      const result = { type: 'moveTrack', params: { trackId, newPosition } }
      operations.push(result)
      return result
    },

    toggleTrackMute: (trackId: string, targetMuteState?: boolean) => {
      const params: any = { trackId }
      if (targetMuteState !== undefined) params.targetMuteState = targetMuteState
      const result = { type: 'toggleTrackMute', params }
      operations.push(result)
      return result
    },

    toggleTrackVisibility: (trackId: string, targetVisible?: boolean) => {
      const params: any = { trackId }
      if (targetVisible !== undefined) params.targetVisible = targetVisible
      const result = { type: 'toggleTrackVisibility', params }
      operations.push(result)
      return result
    },

    // === 时间轴项目属性更新 ===

    updateTimelineItem: (itemId: string, options: {
      x?: number
      y?: number
      width?: number
      height?: number
      rotation?: number
      opacity?: number
      proportionalScale?: boolean
      volume?: number
      isMuted?: boolean
      duration?: number
      playbackRate?: number
    }) => {
      // 处理参数：将 rotation 从角度转换为弧度
      const processedOptions = { ...options }
      if (options.rotation !== undefined) {
        // 角度转弧度：Agent 传递角度（如 90），底层需要弧度（如 Math.PI / 2）
        processedOptions.rotation = (options.rotation * Math.PI) / 180
      }

      const result = { type: 'updateTimelineItem', params: { itemId, ...processedOptions } }
      operations.push(result)
      return result
    },

    // === 时间码计算方法 ===

    /**
     * 时间码加法
     * @param timecode1 第一个时间码 (格式: HH:MM:SS.FF)
     * @param timecode2 第二个时间码 (格式: HH:MM:SS.FF)
     * @returns 相加后的时间码字符串
     */
    addTimecodes: (timecode1: string, timecode2: string) => {
      try {
        const frames1 = timecodeToFrames(timecode1)
        const frames2 = timecodeToFrames(timecode2)
        const result = frames1 + frames2
        const resultTimecode = framesToTimecode(result)
        console.log(`addTimecodes('${timecode1}', '${timecode2}') = '${resultTimecode}'`)
        return resultTimecode
      } catch (error) {
        throw new Error(`时间码加法失败: ${error instanceof Error ? error.message : String(error)}`)
      }
    },

    /**
     * 时间码减法
     * @param timecode1 被减时间码 (格式: HH:MM:SS.FF)
     * @param timecode2 减数时间码 (格式: HH:MM:SS.FF)
     * @returns 相减后的时间码字符串,负数结果会带负号
     */
    subtractTimecodes: (timecode1: string, timecode2: string) => {
      try {
        const frames1 = timecodeToFrames(timecode1)
        const frames2 = timecodeToFrames(timecode2)
        const result = frames1 - frames2

        // 处理负数结果
        let resultTimecode: string
        if (result < 0) {
          const absResult = Math.abs(result)
          resultTimecode = `-${framesToTimecode(absResult)}`
        } else {
          resultTimecode = framesToTimecode(result)
        }

        console.log(`subtractTimecodes('${timecode1}', '${timecode2}') = '${resultTimecode}'`)
        return resultTimecode
      } catch (error) {
        throw new Error(`时间码减法失败: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
  }
}

// Worker消息处理 - 直接执行用户脚本
self.onmessage = async function (e) {
  const { script } = e.data

  try {
    // 重置操作数组和日志数组
    operations = []
    logs.length = 0

    // 创建API上下文
    const api = buildAPI()

    // 创建执行函数并执行
    const functionKeys = Object.keys(api)
    const functionValues = functionKeys.map((key) => api[key as keyof typeof api])

    const userFunction = new Function(...functionKeys, script)
    userFunction(...functionValues)

    // 返回结果
    self.postMessage({
      success: true,
      operations: operations,
      logs: logs,
    })
  } catch (error) {
    self.postMessage({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      logs: logs, // 即使出错也发送已捕获的日志
    })
  }
}
