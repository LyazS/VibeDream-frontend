import type { ModelTool } from '../../transport/AgentClient'
import { askUserDefinition } from './askUser'
import { readProjectInfoDefinition } from './readProjectInfo'
import { modifyProjectInfoDefinition } from './modifyProjectInfo'
import { listMediaDefinition } from './listMedia'
import { readMediaDefinition } from './readMedia'
import { searchMediaDefinition } from './searchMedia'
import { createFolderDefinition } from './createFolder'
import { renameLibraryItemDefinition } from './renameLibraryItem'
import { moveLibraryItemsDefinition } from './moveLibraryItems'
import { deleteEmptyFolderDefinition } from './deleteEmptyFolder'
import { addTrackDefinition } from './addTrack'
import { listTracksDefinition } from './listTracks'
import { readTracksDefinition } from './readTracks'
import { moveTrackDefinition } from './moveTrack'
import { updateTrackPropertiesDefinition } from './updateTrackProperties'
import { removeTrackDefinition } from './removeTrack'
import { createSubtitleClipDefinition } from './createSubtitleClip'
import { insertClipDefinition } from './insertClip'
import { moveClipDefinition } from './moveClip'
import { splitClipDefinition } from './splitClip'
import { trimClipDefinition } from './trimClip'
import { removeItemDefinition } from './removeItem'
import { searchTransitionsDefinition } from './searchTransitions'
import { applyTransitionDefinition } from './applyTransition'
import { readItemDefinition } from './readItem'
import { describeItemPropertyDefinition } from './describeItemProperty'
import { updateItemDefinition } from './updateItem'
import { readClipKeyframeDefinition } from './readClipKeyframe'
import { writeClipKeyframeDefinition } from './writeClipKeyframe'
import { patchClipKeyframeDefinition } from './patchClipKeyframe'

export const toolContractVersion = 'editor-tools-v1'

/** 模型调用和本地参数校验共享的公开工具契约。 */
export const agentTools: ModelTool[] = [
  askUserDefinition,
  readProjectInfoDefinition,
  modifyProjectInfoDefinition,
  listMediaDefinition,
  readMediaDefinition,
  searchMediaDefinition,
  createFolderDefinition,
  renameLibraryItemDefinition,
  moveLibraryItemsDefinition,
  deleteEmptyFolderDefinition,
  addTrackDefinition,
  listTracksDefinition,
  readTracksDefinition,
  moveTrackDefinition,
  updateTrackPropertiesDefinition,
  removeTrackDefinition,
  createSubtitleClipDefinition,
  insertClipDefinition,
  moveClipDefinition,
  splitClipDefinition,
  trimClipDefinition,
  removeItemDefinition,
  searchTransitionsDefinition,
  applyTransitionDefinition,
  readItemDefinition,
  describeItemPropertyDefinition,
  updateItemDefinition,
  readClipKeyframeDefinition,
  writeClipKeyframeDefinition,
  patchClipKeyframeDefinition,
]
