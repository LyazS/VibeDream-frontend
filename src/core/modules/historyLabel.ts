export type HistoryLabelKey =
  | 'notification.history.command.addTimelineItem'
  | 'notification.history.command.removeTimelineItem'
  | 'notification.history.command.moveTimelineItem'
  | 'notification.history.command.moveTimelineItemNamed'
  | 'notification.history.command.resizeTimelineItem'
  | 'notification.history.command.resizeTimelineItemNamed'
  | 'notification.history.command.trimTimelineItem'
  | 'notification.history.command.trimTimelineItemNamed'
  | 'notification.history.command.splitTimelineItem'
  | 'notification.history.command.splitTimelineItemNamed'
  | 'notification.history.command.addTrack'
  | 'notification.history.command.removeTrack'
  | 'notification.history.command.renameTrack'
  | 'notification.history.command.moveTrack'
  | 'notification.history.command.muteTrack'
  | 'notification.history.command.unmuteTrack'
  | 'notification.history.command.showTrack'
  | 'notification.history.command.hideTrack'
  | 'notification.history.command.updateFilter'
  | 'notification.history.command.removeFilter'
  | 'notification.history.command.updateTransition'
  | 'notification.history.command.addMarker'
  | 'notification.history.command.removeMarker'
  | 'notification.history.command.clearAllMarkers'
  | 'notification.history.command.generateAIMarks'
  | 'notification.history.command.updateAIMarksMode'
  | 'notification.history.command.clearAIMarks'
  | 'notification.history.command.clearAllKeyframes'
  | 'notification.history.command.selectItems'
  | 'notification.history.command.clearSelection'
  | 'notification.history.command.addSelection'
  | 'notification.history.command.removeSelection'
  | 'notification.history.command.toggleSelection'
  | 'notification.history.command.createDirectory'
  | 'notification.history.command.renameDirectory'
  | 'notification.history.command.moveDirectory'
  | 'notification.history.command.deleteDirectory'
  | 'notification.history.command.renameAsset'
  | 'notification.history.command.moveLibraryItems'
  | 'notification.history.command.batchDeleteTimelineItems'
  | 'notification.history.command.autoArrangeTrack'
  | 'notification.history.command.updateProperties'
  | 'notification.history.command.updateMask'
  | 'notification.history.command.scriptedBatch'
  | 'notification.history.command.deleteClips'
  | 'notification.history.command.deleteTimelineItems'
  | 'notification.history.command.updateClipProperties'
  | 'notification.history.command.updateKeyframes'

export interface HistoryLabel {
  key: HistoryLabelKey
  params?: Record<string, string | number>
}

function label(key: HistoryLabelKey, params?: HistoryLabel['params']): HistoryLabel {
  return params ? { key, params } : { key }
}

export const historyLabels = {
  addTimelineItem: () => label('notification.history.command.addTimelineItem'),
  removeTimelineItem: () => label('notification.history.command.removeTimelineItem'),
  moveTimelineItem: (name?: string) =>
    name
      ? label('notification.history.command.moveTimelineItemNamed', { name })
      : label('notification.history.command.moveTimelineItem'),
  resizeTimelineItem: (name?: string) =>
    name
      ? label('notification.history.command.resizeTimelineItemNamed', { name })
      : label('notification.history.command.resizeTimelineItem'),
  trimTimelineItem: (name?: string) =>
    name
      ? label('notification.history.command.trimTimelineItemNamed', { name })
      : label('notification.history.command.trimTimelineItem'),
  splitTimelineItem: (name?: string) =>
    name
      ? label('notification.history.command.splitTimelineItemNamed', { name })
      : label('notification.history.command.splitTimelineItem'),
  addTrack: () => label('notification.history.command.addTrack'),
  removeTrack: (name: string) => label('notification.history.command.removeTrack', { name }),
  renameTrack: (name: string) => label('notification.history.command.renameTrack', { name }),
  moveTrack: (name: string) => label('notification.history.command.moveTrack', { name }),
  muteTrack: (name: string) => label('notification.history.command.muteTrack', { name }),
  unmuteTrack: (name: string) => label('notification.history.command.unmuteTrack', { name }),
  showTrack: (name: string) => label('notification.history.command.showTrack', { name }),
  hideTrack: (name: string) => label('notification.history.command.hideTrack', { name }),
  updateFilter: () => label('notification.history.command.updateFilter'),
  removeFilter: () => label('notification.history.command.removeFilter'),
  updateTransition: () => label('notification.history.command.updateTransition'),
  addMarker: () => label('notification.history.command.addMarker'),
  removeMarker: () => label('notification.history.command.removeMarker'),
  clearAllMarkers: () => label('notification.history.command.clearAllMarkers'),
  generateAIMarks: () => label('notification.history.command.generateAIMarks'),
  updateAIMarksMode: () => label('notification.history.command.updateAIMarksMode'),
  clearAIMarks: () => label('notification.history.command.clearAIMarks'),
  clearAllKeyframes: () => label('notification.history.command.clearAllKeyframes'),
  selectItems: (count: number) => label('notification.history.command.selectItems', { count }),
  clearSelection: () => label('notification.history.command.clearSelection'),
  addSelection: (count: number) => label('notification.history.command.addSelection', { count }),
  removeSelection: (count: number) =>
    label('notification.history.command.removeSelection', { count }),
  toggleSelection: (count: number) =>
    label('notification.history.command.toggleSelection', { count }),
  createDirectory: (name: string) =>
    label('notification.history.command.createDirectory', { name }),
  renameDirectory: (name: string) =>
    label('notification.history.command.renameDirectory', { name }),
  moveDirectory: () => label('notification.history.command.moveDirectory'),
  deleteDirectory: () => label('notification.history.command.deleteDirectory'),
  renameAsset: (name: string) => label('notification.history.command.renameAsset', { name }),
  moveLibraryItems: (count: number) =>
    label('notification.history.command.moveLibraryItems', { count }),
  batchDeleteTimelineItems: (count: number) =>
    label('notification.history.command.batchDeleteTimelineItems', { count }),
  autoArrangeTrack: (name: string) =>
    label('notification.history.command.autoArrangeTrack', { name }),
  updateProperties: (count?: number) =>
    label(
      'notification.history.command.updateProperties',
      count === undefined ? undefined : { count },
    ),
  updateMask: (count: number) => label('notification.history.command.updateMask', { count }),
  scriptedBatch: () => label('notification.history.command.scriptedBatch'),
  deleteClips: (count: number) => label('notification.history.command.deleteClips', { count }),
  deleteTimelineItems: (count: number) =>
    label('notification.history.command.deleteTimelineItems', { count }),
  updateClipProperties: () => label('notification.history.command.updateClipProperties'),
  updateKeyframes: () => label('notification.history.command.updateKeyframes'),
}
