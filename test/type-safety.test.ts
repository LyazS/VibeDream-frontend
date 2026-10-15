import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  decodeSora2Prompt,
  flattenAiConfig,
  getValueByPath,
  getValueByPathWithWrapper,
  hasPath,
  setValueByPath,
  setValueByPathWithWrapper,
} from '@/components/ai-generation/utils/pathUtils'
import { isFileData } from '@/core/datasource/providers/ai-generation/typeGuards'
import type { FileData } from '@/core/datasource/providers/ai-generation/types'
import { buildToolException } from '@/core/agent/tools/utils/result'

afterEach(() => vi.restoreAllMocks())

describe('generation configuration paths', () => {
  it('edits existing arrays and creates missing nested objects', () => {
    const config = { images: [{ name: 'original' }] }
    setValueByPath(config, 'images.0.name', 'edited')
    setValueByPath(config, 'settings.video.duration', 0)
    expect(config.images).toEqual([{ name: 'edited' }])
    expect(getValueByPath(config, 'settings.video.duration')).toBe(0)
    expect(getValueByPath(config, 'images.0.name')).toBe('edited')
    expect(hasPath(config, 'settings.video.duration')).toBe(true)
  })

  it('handles missing paths and malformed intermediate values', () => {
    expect(getValueByPath({ video: null }, 'video.duration')).toBeUndefined()
    expect(getValueByPath({ prompt: 'hello' }, 'prompt.length')).toBe(5)
    expect(hasPath({ prompt: 'hello' }, 'prompt.length')).toBe(false)
    expect(hasPath(null, 'video.duration')).toBe(false)
    expect(hasPath({ value: undefined }, 'value')).toBe(true)
  })

  it('preserves wrapper metadata while editing and submitting falsy values', () => {
    const seed = { type: 'number', value: 42, label: 'Seed' }
    const config = { seed, enabled: { type: 'boolean', value: false } }
    setValueByPathWithWrapper(config, 'seed', 0)
    setValueByPathWithWrapper(config, 'prompt', '')
    expect(config.seed).toBe(seed)
    expect(seed).toEqual({ type: 'number', value: 0, label: 'Seed' })
    expect(getValueByPathWithWrapper(config, 'seed')).toBe(0)
    expect(flattenAiConfig(config)).toEqual({ seed: 0, enabled: false, prompt: '' })
  })

  it('decodes prompt tags and retains arrays and unwrapped values on submission', () => {
    const images = ['image-1', 'image-2']
    const config = {
      prompt: { type: 'sora2prompt', value: 'Hello [[{"value":"actor.one"}]] world' },
      images: { type: 'array', value: images },
      extra: null,
      rawImages: images,
    }
    expect(flattenAiConfig(config)).toEqual({
      prompt: 'Hello @actor.one world',
      images,
      extra: null,
      rawImages: images,
    })
    expect(decodeSora2Prompt('[[null]] [[42]] [[{"label":"missing value"}]]')).toBe(
      '[[null]] [[42]] [[{"label":"missing value"}]]',
    )
  })
})

describe('file data at the drag-and-drop boundary', () => {
  const file: FileData = {
    __type__: 'FileData',
    name: 'clip.mp4',
    mediaType: 'video',
    source: 'media-item',
    mediaItemId: 'media-1',
  }

  it('accepts media files and timeline clips with their optional metadata', () => {
    expect(isFileData(file)).toBe(true)
    expect(
      isFileData({
        ...file,
        source: 'timeline-item',
        timelineItemId: 'clip-1',
        duration: 5,
        resolution: { width: 1920, height: 1080 },
        timeRange: {
          clipStartTime: 0,
          clipEndTime: 5,
          timelineStartTime: 10,
          timelineEndTime: 15,
        },
      }),
    ).toBe(true)
  })

  it.each([
    null,
    [],
    'file',
    {},
    { ...file, name: 123 },
    { ...file, mediaType: 'text' },
    { ...file, source: 'unknown' },
    { ...file, mediaItemId: 123 },
    { ...file, duration: '5' },
    { ...file, resolution: { width: 1920 } },
    { ...file, timeRange: { clipStartTime: 0 } },
  ])('rejects malformed file data %#', (value) => {
    expect(isFileData(value)).toBe(false)
  })
})

describe('tool exception responses', () => {
  it.each([
    [new Error('failed'), 'failed'],
    ['failed', 'failed'],
    [null, 'null'],
  ])('serializes thrown values without requiring an Error object %#', (error, message) => {
    const result = buildToolException('update_item', error)
    expect(result.success).toBe(false)
    expect(result.error).toBe(message)
    expect(JSON.parse(result.output)).toEqual({
      tool: 'update_item',
      error: message,
      code: 'internal_error',
    })
  })

  it('preserves a domain error code and details while retaining the error string', () => {
    const details = {
      current: { itemId: 'media_take01.mp4', name: '镜头', parentDirId: 'dir_root' },
    }
    const error = Object.assign(new Error('项目状态已变化'), {
      toolCode: 'state_mismatch',
      toolDetails: details,
    })
    const result = buildToolException('rename_library_item', error)
    expect(result.success).toBe(false)
    expect(result.error).toBe('项目状态已变化')
    expect(JSON.parse(result.output)).toEqual({
      tool: 'rename_library_item',
      error: '项目状态已变化',
      code: 'state_mismatch',
      details,
    })
  })
})
