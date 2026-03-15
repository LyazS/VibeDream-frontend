/**
 * RemixIcon 组件映射
 * 用于集中管理所有使用的图标组件
 */
import {
  // 轨道类型
  RiVidiconLine,
  RiVolumeUpLine,
  RiText,

  // 控制按钮
  RiAddLine,
  RiEyeLine,
  RiEyeOffLine,
  RiVolumeMuteLine,

  // 播放控制
  RiPlayLargeFill,
  RiPauseLargeFill,
  RiStopLargeFill,
  RiArrowDownSLine,

  // 搜索和更多
  RiSearchLine,
  RiMore2Fill,
  RiListCheck,
  RiFolderLine,
  RiHomeOfficeFill,
  RiVideoLine,
  RiSparklingFill,
  RiRobot2Fill,
  RiToolsFill,

  // 编辑操作
  RiArrowGoBackLine,
  RiArrowGoForwardLine,
  RiScissorsLine,
  RiDeleteBinLine,
  RiPushpinFill,
  RiUnpinLine,
  RiDraggable,

  // 关键帧控制
  RiCheckboxBlankCircleLine,
  RiCheckboxBlankLine,
  RiCheckboxMultipleLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,

  // 对齐图标
  RiAlignLeft,
  RiAlignCenter,
  RiAlignRight,
  RiAlignItemLeftFill,
  RiAlignItemHorizontalCenterFill,
  RiAlignItemRightFill,
  RiAlignItemTopFill,
  RiAlignItemVerticalCenterFill,
  RiAlignItemBottomFill,

  // 文件夹操作
  RiFolderFill,
  RiFolderOpenLine,
  RiFolderAddLine,
  RiFolder3Line,

  // 文件操作
  RiFileCopyLine,
  RiEditLine,
  RiCloseLine,
  RiUpload2Line,
  RiDownloadLine,

  // 用户相关
  RiUserFill,
  RiUserLine,
  RiUserFollowFill,
  RiUserUnfollowLine,
  RiUserUnfollowFill,
  RiLogoutBoxLine,
  RiKeyLine,

  // 通知图标
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiErrorWarningLine,
  RiInformationLine,

  // 工具图标
  RiTranslate,
  RiLoader4Line,
  RiQuestionLine,
  RiMagicLine,
  RiTimeLine,

  // 媒体相关
  RiMusic2Fill,

  // AI 相关
  RiChatAiFill,
  RiHistoryLine,
  RiSendPlaneFill,

  // 视图控制
  RiImage2Line,
  RiImageLine,
  RiListUnordered,
  RiGridLine,

  // 排序
  RiSortAsc,
  RiSortDesc,
  RiCalendarLine,

  // 剪贴板
  RiClipboardLine,
  RiDeleteBack2Line,
  RiScissorsCutLine,

  // 导航
  RiArrowUpLine,
  RiHome9Fill,

  // 其他
  RiAddCircleLine,
  RiCheckLine,
  RiInboxLine,
  RiBugLine,
  RiRefreshLine,
  RiLayoutGridLine,
  RiToolsLine,
} from '@remixicon/vue'

/**
 * 图标组件映射对象
 */
export const IconComponents = {
  // 轨道类型
  TRACK_VIDEO: RiVidiconLine,
  TRACK_AUDIO: RiVolumeUpLine,
  TRACK_TEXT: RiText,

  // 控制按钮
  ADD: RiAddLine,
  VISIBLE: RiEyeLine,
  HIDDEN: RiEyeOffLine,
  UNMUTED: RiVolumeUpLine,
  MUTED: RiVolumeMuteLine,

  // 播放控制
  PLAY: RiPlayLargeFill,
  PAUSE: RiPauseLargeFill,
  STOP: RiStopLargeFill,
  DROPDOWN: RiArrowDownSLine,

  // 搜索和更多
  SEARCH: RiSearchLine,
  MORE: RiMore2Fill,
  LIST_CHECK: RiListCheck,
  FOLDER_LINE: RiFolderLine,
  HomeOfficeFill: RiHomeOfficeFill,
  VIDEO: RiVideoLine,
  SPARKLING: RiSparklingFill,
  ROBOT: RiRobot2Fill,
  TOOLS_FILL: RiToolsFill,

  // 编辑操作
  UNDO: RiArrowGoBackLine,
  REDO: RiArrowGoForwardLine,
  SPLIT: RiScissorsLine,
  DELETE: RiDeleteBinLine,
  SNAP_ON: RiPushpinFill,
  SNAP_OFF: RiUnpinLine,
  DRAGGABLE: RiDraggable,

  // 关键帧
  KEYFRAME: RiCheckboxBlankCircleLine,
  CHECKBOX_BLANK: RiCheckboxBlankLine,
  CHECKBOX_MULTIPLE: RiCheckboxMultipleLine,
  PREV_KEYFRAME: RiArrowLeftSLine,
  NEXT_KEYFRAME: RiArrowRightSLine,

  // 对齐
  ALIGN_LEFT: RiAlignLeft,
  ALIGN_CENTER: RiAlignCenter,
  ALIGN_RIGHT: RiAlignRight,
  ALIGN_ITEM_LEFT: RiAlignItemLeftFill,
  ALIGN_ITEM_H_CENTER: RiAlignItemHorizontalCenterFill,
  ALIGN_ITEM_RIGHT: RiAlignItemRightFill,
  ALIGN_ITEM_TOP: RiAlignItemTopFill,
  ALIGN_ITEM_V_CENTER: RiAlignItemVerticalCenterFill,
  ALIGN_ITEM_BOTTOM: RiAlignItemBottomFill,

  // 文件夹
  FOLDER: RiFolderFill,
  FOLDER_OPEN: RiFolderOpenLine,
  FOLDER_ADD: RiFolderAddLine,
  FOLDER_3: RiFolder3Line,

  // 文件操作
  COPY: RiFileCopyLine,
  EDIT: RiEditLine,
  CLOSE: RiCloseLine,
  UPLOAD: RiUpload2Line,
  DOWNLOAD: RiDownloadLine,

  // 用户
  USER: RiUserFill,
  USER_LINE: RiUserLine,
  USER_LOGIN: RiUserFollowFill,
  USER_LOGOUT: RiUserUnfollowLine,
  USER_ERROR: RiUserUnfollowFill,
  LOGOUT: RiLogoutBoxLine,
  KEY: RiKeyLine,

  // 通知
  SUCCESS: RiCheckboxCircleLine,
  ERROR: RiCloseCircleLine,
  WARNING: RiErrorWarningLine,
  INFO: RiInformationLine,

  // 工具
  TRANSLATE: RiTranslate,
  LOADING: RiLoader4Line,
  QUESTION: RiQuestionLine,
  MAGIC: RiMagicLine,
  TIME: RiTimeLine,

  // 媒体
  MUSIC: RiMusic2Fill,

  // 导航
  ARROW_UP: RiArrowUpLine,
  HOME: RiHome9Fill,

  // AI
  CHAT_AI: RiChatAiFill,
  HISTORY: RiHistoryLine,
  SEND: RiSendPlaneFill,

  // 视图
  IMAGE_LARGE: RiImage2Line,
  IMAGE_SMALL: RiImageLine,
  LIST: RiListUnordered,
  GRID: RiGridLine,

  // 排序
  SORT_ASC: RiSortAsc,
  SORT_DESC: RiSortDesc,
  CALENDAR: RiCalendarLine,

  // 剪贴板
  CLIPBOARD: RiClipboardLine,
  CLEAR: RiDeleteBack2Line,
  CUT: RiScissorsCutLine,

  // 其他
  ADD_CIRCLE: RiAddCircleLine,
  CHECK: RiCheckLine,
  EMPTY: RiInboxLine,
  DEBUG: RiBugLine,
  REFRESH: RiRefreshLine,
  TEXT_LINE: RiText,
  LAYOUT: RiLayoutGridLine,
  TOOLS: RiToolsLine,
  SETTINGS: RiToolsLine,
  SAVE: RiDownloadLine,
} as const

/**
 * 轨道类型图标映射
 */
export function getTrackTypeIcon(type: 'video' | 'audio' | 'text') {
  const map = {
    video: IconComponents.TRACK_VIDEO,
    audio: IconComponents.TRACK_AUDIO,
    text: IconComponents.TRACK_TEXT,
  }
  return map[type] || IconComponents.TRACK_VIDEO
}

/**
 * 可见性图标
 */
export function getVisibilityIcon(isVisible: boolean) {
  return isVisible ? IconComponents.VISIBLE : IconComponents.HIDDEN
}

/**
 * 静音图标
 */
export function getMuteIcon(isMuted: boolean) {
  return isMuted ? IconComponents.MUTED : IconComponents.UNMUTED
}

/**
 * 播放状态图标
 */
export function getPlaybackIcon(isPlaying: boolean) {
  return isPlaying ? IconComponents.PAUSE : IconComponents.PLAY
}

/**
 * 吸附状态图标
 */
export function getSnapIcon(isEnabled: boolean) {
  return isEnabled ? IconComponents.SNAP_ON : IconComponents.SNAP_OFF
}

/**
 * 用户登录状态图标
 */
export function getUserStatusIcon(isLogin: boolean) {
  return isLogin ? IconComponents.USER_LOGIN : IconComponents.USER_LOGOUT
}

/**
 * 轨道类型标签映射
 */
const TRACK_TYPE_LABELS = {
  video: '视频',
  audio: '音频',
  text: '文本',
  subtitle: '字幕',
} as const

/**
 * 获取轨道类型标签
 */
export function getTrackTypeLabel(type: string): string {
  return TRACK_TYPE_LABELS[type as keyof typeof TRACK_TYPE_LABELS] || '视频'
}
