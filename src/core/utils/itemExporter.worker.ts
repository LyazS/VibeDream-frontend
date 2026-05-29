import {
  QUALITY_MEDIUM,
  Conversion,
  Input,
  Output,
  Mp4OutputFormat,
  Mp3OutputFormat,
  BufferTarget,
  BlobSource,
  ALL_FORMATS,
} from 'mediabunny'

type ExportWorkerConfig =
  | { task: 'video-media'; file: File; width: number; height: number; frameRate?: number }
  | {
      task: 'video-timeline'
      file: File
      width: number
      height: number
      frameRate?: number
      trimStart: number
      trimEnd: number
    }
  | { task: 'audio-timeline'; file: File; trimStart: number; trimEnd: number }

type InboundMessage =
  | { type: 'export'; config: ExportWorkerConfig }
  | { type: 'abort' }

let currentConversion: Conversion | null = null

async function handleVideoExport(
  file: File,
  width: number,
  height: number,
  frameRate?: number,
  trim?: { start: number; end: number },
): Promise<void> {
  const conversion = await Conversion.init({
    input: new Input({ source: new BlobSource(file), formats: ALL_FORMATS }),
    output: new Output({
      format: new Mp4OutputFormat(),
      target: new BufferTarget(),
    }),
    video: {
      width,
      height,
      fit: 'contain',
      frameRate,
      bitrate: QUALITY_MEDIUM,
    },
    audio: {
      bitrate: QUALITY_MEDIUM,
    },
    ...(trim ? { trim } : {}),
    showWarnings: false,
  })

  if (!conversion.isValid) {
    throw new Error('Conversion 配置无效，请检查输入文件和输出格式')
  }

  currentConversion = conversion
  conversion.onProgress = (progress: number) => {
    self.postMessage({ type: 'progress', progress })
  }

  await conversion.execute()

  const buffer = (conversion.output.target as BufferTarget).buffer
  if (!buffer) {
    throw new Error('Conversion 输出为空')
  }

  self.postMessage({ type: 'done', buffer, mimeType: 'video/mp4' }, [buffer])
}

async function handleAudioTimelineExport(
  file: File,
  trimStart: number,
  trimEnd: number,
): Promise<void> {
  const conversion = await Conversion.init({
    input: new Input({ source: new BlobSource(file), formats: ALL_FORMATS }),
    output: new Output({
      format: new Mp3OutputFormat(),
      target: new BufferTarget(),
    }),
    video: { discard: true },
    audio: {
      bitrate: QUALITY_MEDIUM,
    },
    trim: { start: trimStart, end: trimEnd },
    showWarnings: false,
  })

  if (!conversion.isValid) {
    throw new Error('Conversion 配置无效，请检查输入文件和输出格式')
  }

  currentConversion = conversion
  conversion.onProgress = (progress: number) => {
    self.postMessage({ type: 'progress', progress })
  }

  await conversion.execute()

  const buffer = (conversion.output.target as BufferTarget).buffer
  if (!buffer) {
    throw new Error('Conversion 输出为空')
  }

  self.postMessage({ type: 'done', buffer, mimeType: 'audio/mpeg' }, [buffer])
}

self.onmessage = async (e: MessageEvent<InboundMessage>) => {
  const { type } = e.data

  if (type === 'abort') {
    if (currentConversion) {
      currentConversion.cancel()
      currentConversion = null
    }
    return
  }

  if (type === 'export') {
    const { config } = e.data
    try {
      currentConversion = null

      switch (config.task) {
        case 'video-media':
          await handleVideoExport(config.file, config.width, config.height, config.frameRate)
          break
        case 'video-timeline':
          await handleVideoExport(
            config.file,
            config.width,
            config.height,
            config.frameRate,
            { start: config.trimStart, end: config.trimEnd },
          )
          break
        case 'audio-timeline':
          await handleAudioTimelineExport(config.file, config.trimStart, config.trimEnd)
          break
        default:
          throw new Error(`未知的导出任务: ${(config as ExportWorkerConfig & { task: string }).task}`)
      }
    } catch (error) {
      self.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      currentConversion = null
    }
  }
}
