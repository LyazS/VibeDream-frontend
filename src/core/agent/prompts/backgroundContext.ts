import { FRAME_RATE } from '@/constants/TimeConstants'
import { MODULE_NAMES, type ModuleMap, type ModuleRegistry } from '@/core/modules/ModuleRegistry'
import { calculateVisibleFrameRange } from '@/core/utils/timelineScaleUtils'
import { framesToTimecode } from '@/core/utils/timeUtils'
import { buildCanonicalDirectoryPath } from '@/core/directory/directoryPath'
import { MessagePartType, type BackgroundContextPart } from '../types'

/** Capture synchronously on user input; tool continuations and reloads reuse the snapshot. */
export function captureBackgroundContext(registry: ModuleRegistry): BackgroundContextPart {
  const config = registry.get<ModuleMap['config']>(MODULE_NAMES.CONFIG)
  const selection = registry.get<ModuleMap['selection']>(MODULE_NAMES.SELECTION)
  const directory = registry.get<ModuleMap['directory']>(MODULE_NAMES.DIRECTORY)
  const media = registry.get<ModuleMap['media']>(MODULE_NAMES.MEDIA)
  const playback = registry.get<ModuleMap['playback']>(MODULE_NAMES.PLAYBACK)
  const viewport = registry.get<ModuleMap['viewport']>(MODULE_NAMES.VIEWPORT)
  const directories = directory.directories.value
  const path = (id: string | null) =>
    id === null ? null : buildCanonicalDirectoryPath(id, directories)
  const timecode = (frame: number) =>
    Number.isSafeInteger(frame) && frame >= 0 ? framesToTimecode(frame) : null
  const currentDirectory = directory.currentDir.value
  const selectedLibraryItems = [...selection.selectedLibraryAssetIds.value].map((id) => {
    const folder = directory.getDirectory(id)
    const asset = folder ? undefined : media.getAsset(id)
    const parentId = folder ? folder.parentId : directory.getAssetDirectoryId(id)
    return {
      type: folder ? 'directory' : asset ? asset.assetKind : 'unknown',
      id,
      name: folder?.name ?? asset?.name ?? null,
      parent_dir_id: parentId,
      parent_path: path(parentId),
      ...(folder ? { path: path(id) } : {}),
    }
  })
  const { startFrames, endFrames } = calculateVisibleFrameRange(
    viewport.TimelineContentWidth.value,
    viewport.totalDurationFrames.value,
    viewport.zoomLevel.value,
    viewport.scrollOffset.value,
    viewport.maxVisibleDurationFrames.value,
  )
  const visibleStart = timecode(startFrames)
  const visibleEnd = timecode(endFrames)
  return {
    type: MessagePartType.BACKGROUND_CONTEXT,
    text: JSON.stringify({
      captured_at: new Date().toISOString(),
      project_id: config.projectId.value,
      project_name: config.projectName.value,
      fps: FRAME_RATE,
      current_library_directory: currentDirectory
        ? { dir_id: currentDirectory.id, path: path(currentDirectory.id) }
        : null,
      selected_library_items: selectedLibraryItems,
      selected_clip_ids: [...selection.selectedClipTimelineItemIds.value],
      playhead_time: timecode(playback.currentFrame.value),
      visible_time_range:
        visibleStart !== null && visibleEnd !== null && endFrames >= startFrames
          ? { start: visibleStart, end: visibleEnd }
          : null,
    }),
  }
}
