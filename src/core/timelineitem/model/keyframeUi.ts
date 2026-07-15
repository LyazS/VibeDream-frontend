/**
 * 关键帧按钮状态
 */
export type KeyframeButtonState = 'none' | 'on-keyframe' | 'between-keyframes'

/**
 * 关键帧UI状态
 */
export interface KeyframeUIState {
  /** 是否有动画 */
  hasAnimation: boolean
  /** 当前帧是否在关键帧位置 */
  isOnKeyframe: boolean
}
