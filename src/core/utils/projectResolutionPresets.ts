import type { VideoResolution } from '@/core/types'
import { i18n } from '@/locales'

export type ProjectResolutionPresetKey =
  | 'landscape_4k'
  | 'landscape_1440p'
  | 'landscape_1080p'
  | 'landscape_720p'
  | 'landscape_480p'
  | 'portrait_4k'
  | 'portrait_1440p'
  | 'portrait_1080p'
  | 'portrait_720p'
  | 'portrait_480p'
  | 'square_1080'
  | 'square_720'
  | 'ultrawide_21_9'
  | 'ultrawide_32_9'

interface ProjectResolutionPresetDefinition {
  key: ProjectResolutionPresetKey
  nameKey: string
  width: number
  height: number
  aspectRatio: string
  categoryKey: string
}

export interface ProjectResolutionValue extends VideoResolution {
  category: string
}

export interface ProjectResolutionPreset extends ProjectResolutionValue {
  presetKey: ProjectResolutionPresetKey
}

const MAX_CUSTOM_WIDTH = 7680
const MAX_CUSTOM_HEIGHT = 4320

const PRESET_DEFINITIONS: ProjectResolutionPresetDefinition[] = [
  {
    key: 'landscape_4k',
    nameKey: 'editor.resolution.4K',
    width: 3840,
    height: 2160,
    aspectRatio: '16:9',
    categoryKey: 'editor.landscape',
  },
  {
    key: 'landscape_1440p',
    nameKey: 'editor.resolution.1440p',
    width: 2560,
    height: 1440,
    aspectRatio: '16:9',
    categoryKey: 'editor.landscape',
  },
  {
    key: 'landscape_1080p',
    nameKey: 'editor.resolution.1080p',
    width: 1920,
    height: 1080,
    aspectRatio: '16:9',
    categoryKey: 'editor.landscape',
  },
  {
    key: 'landscape_720p',
    nameKey: 'editor.resolution.720p',
    width: 1280,
    height: 720,
    aspectRatio: '16:9',
    categoryKey: 'editor.landscape',
  },
  {
    key: 'landscape_480p',
    nameKey: 'editor.resolution.480p',
    width: 854,
    height: 480,
    aspectRatio: '16:9',
    categoryKey: 'editor.landscape',
  },
  {
    key: 'portrait_4k',
    nameKey: 'editor.resolution.4KPortrait',
    width: 2160,
    height: 3840,
    aspectRatio: '9:16',
    categoryKey: 'editor.portrait',
  },
  {
    key: 'portrait_1440p',
    nameKey: 'editor.resolution.1440pPortrait',
    width: 1440,
    height: 2560,
    aspectRatio: '9:16',
    categoryKey: 'editor.portrait',
  },
  {
    key: 'portrait_1080p',
    nameKey: 'editor.resolution.1080pPortrait',
    width: 1080,
    height: 1920,
    aspectRatio: '9:16',
    categoryKey: 'editor.portrait',
  },
  {
    key: 'portrait_720p',
    nameKey: 'editor.resolution.720pPortrait',
    width: 720,
    height: 1280,
    aspectRatio: '9:16',
    categoryKey: 'editor.portrait',
  },
  {
    key: 'portrait_480p',
    nameKey: 'editor.resolution.480pPortrait',
    width: 480,
    height: 854,
    aspectRatio: '9:16',
    categoryKey: 'editor.portrait',
  },
  {
    key: 'square_1080',
    nameKey: 'editor.resolution.1080x1080',
    width: 1080,
    height: 1080,
    aspectRatio: '1:1',
    categoryKey: 'editor.square',
  },
  {
    key: 'square_720',
    nameKey: 'editor.resolution.720x720',
    width: 720,
    height: 720,
    aspectRatio: '1:1',
    categoryKey: 'editor.square',
  },
  {
    key: 'ultrawide_21_9',
    nameKey: 'editor.resolution.ultrawide21x9',
    width: 2560,
    height: 1080,
    aspectRatio: '21:9',
    categoryKey: 'editor.ultrawide',
  },
  {
    key: 'ultrawide_32_9',
    nameKey: 'editor.resolution.ultrawide32x9',
    width: 3840,
    height: 1080,
    aspectRatio: '32:9',
    categoryKey: 'editor.ultrawide',
  },
]

function getCustomAspectRatio(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const divisor = gcd(width, height)
  return `${width / divisor}:${height / divisor}`
}

function toLocalizedResolution(definition: ProjectResolutionPresetDefinition): ProjectResolutionValue {
  return {
    name: i18n.global.t(definition.nameKey),
    width: definition.width,
    height: definition.height,
    aspectRatio: definition.aspectRatio,
    category: i18n.global.t(definition.categoryKey),
  }
}

export function listProjectResolutionPresets(): Array<
  ProjectResolutionPreset
> {
  return PRESET_DEFINITIONS.map((definition) => ({
    presetKey: definition.key,
    ...toLocalizedResolution(definition),
  }))
}

export function findProjectResolutionPresetByKey(
  presetKey: string,
): ProjectResolutionPreset | null {
  const definition = PRESET_DEFINITIONS.find((item) => item.key === presetKey)
  if (!definition) {
    return null
  }

  return {
    presetKey: definition.key,
    ...toLocalizedResolution(definition),
  }
}

export function getProjectResolutionPresetKey(
  resolution: Pick<VideoResolution, 'width' | 'height'>,
): ProjectResolutionPresetKey | null {
  const definition = PRESET_DEFINITIONS.find(
    (item) => item.width === resolution.width && item.height === resolution.height,
  )
  return definition?.key ?? null
}

export function createProjectCustomResolution(width: number, height: number): ProjectResolutionValue {
  return {
    name: i18n.global.t('editor.custom'),
    width,
    height,
    aspectRatio: getCustomAspectRatio(width, height),
    category: i18n.global.t('editor.custom'),
  }
}

export function resolveProjectResolutionFromCanvas(params: {
  presetKey?: string
  width?: number
  height?: number
}): ProjectResolutionValue | null {
  const { presetKey, width, height } = params

  if (typeof presetKey === 'string') {
    const preset = findProjectResolutionPresetByKey(presetKey)
    return preset
  }

  if (typeof width === 'number' && typeof height === 'number') {
    const existingPresetKey = getProjectResolutionPresetKey({ width, height })
    if (existingPresetKey) {
      return findProjectResolutionPresetByKey(existingPresetKey)
    }
    return createProjectCustomResolution(width, height)
  }

  return null
}

export function validateProjectCanvasDimensions(width: number, height: number): string | null {
  if (!Number.isInteger(width) || width <= 0) {
    return 'canvas.width 必须是正整数。'
  }
  if (!Number.isInteger(height) || height <= 0) {
    return 'canvas.height 必须是正整数。'
  }
  if (width > MAX_CUSTOM_WIDTH) {
    return `canvas.width 不能超过 ${MAX_CUSTOM_WIDTH}。`
  }
  if (height > MAX_CUSTOM_HEIGHT) {
    return `canvas.height 不能超过 ${MAX_CUSTOM_HEIGHT}。`
  }
  return null
}
