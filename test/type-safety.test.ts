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
import { BizyAirRequestBuilder } from '@/core/datasource/providers/bizyair/BizyAirRequestBuilder'
import type { BizyAirAppConfig } from '@/core/datasource/providers/bizyair/types'
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

describe('generation request mapping', () => {
  const appConfig: BizyAirAppConfig = {
    id: 'test',
    variant: 'default',
    web_app_id: 123,
    name: 'Test',
    description: '',
    media_type: 'video',
    cost: '0.00',
    input_mapping: {
      prompt: { mapping: '1:Text.prompt', type: 'string', default: 'default prompt' },
      seed: { mapping: '2:Sampler.seed', type: 'random_seed', default: -1 },
      enabled: { mapping: '2:Sampler.enabled', type: 'boolean', default: true },
      images: { mapping: '3:Images.urls', type: 'arrayurl', separator: '\n' },
      size: {
        type: 'array',
        items: [
          { mapping: '4:Size.width', type: 'number' },
          { mapping: '4:Size.height', type: 'number' },
        ],
      },
      local: { mapping: 'ignored', type: 'string', skip_mapping: true },
      missing: { mapping: 'missing', type: 'string' },
    },
  }

  it('preserves explicit empty, zero and false values and maps file URLs and arrays', () => {
    expect(
      BizyAirRequestBuilder.build(
        {
          prompt: '',
          seed: 0,
          enabled: false,
          images: ['https://example.com/1.png', 'https://example.com/2.png'],
          size: [1280, 720],
          local: 'local only',
        },
        appConfig,
      ),
    ).toEqual({
      web_app_id: 123,
      suppress_preview_output: false,
      input_values: {
        '1:Text.prompt': '',
        '2:Sampler.seed': 0,
        '2:Sampler.enabled': false,
        '3:Images.urls': 'https://example.com/1.png\nhttps://example.com/2.png',
        '4:Size.width': 1280,
        '4:Size.height': 720,
      },
    })
  })

  it('uses defaults and generates a random seed only for -1', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(BizyAirRequestBuilder.build({}, appConfig).input_values).toEqual({
      '1:Text.prompt': 'default prompt',
      '2:Sampler.seed': 2147483647,
      '2:Sampler.enabled': true,
    })
  })

  it('omits malformed array inputs instead of mapping them as file lists', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(
      BizyAirRequestBuilder.build({ images: 'not an array', size: {} }, appConfig).input_values,
    ).not.toHaveProperty('3:Images.urls')
    expect(BizyAirRequestBuilder.build({ size: {} }, appConfig).input_values).not.toHaveProperty(
      '4:Size.width',
    )
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
    expect(JSON.parse(result.output)).toEqual({ tool: 'update_item', error: message })
  })
})
