import { useUnifiedStore } from '@/core/unifiedStore'
import {
  getProjectResolutionPresetKey,
  type ProjectResolutionPresetKey,
} from '@/core/utils/projectResolutionPresets'

export interface ProjectInfoCanvasPayload {
  width: number
  height: number
  presetKey: ProjectResolutionPresetKey | null
}

export interface ProjectInfoPayload {
  name: string
  description: string
  canvas: ProjectInfoCanvasPayload
}

export function getCurrentProjectInfo(): ProjectInfoPayload {
  const store = useUnifiedStore()
  const resolution = store.videoResolution

  return {
    name: store.projectName,
    description: store.projectDescription,
    canvas: {
      width: resolution.width,
      height: resolution.height,
      presetKey: getProjectResolutionPresetKey(resolution),
    },
  }
}
