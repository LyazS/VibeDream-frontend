import { reactive } from 'vue'
import { generateTimelineItemId } from '@/core/utils/idGenerator'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { TextMediaConfig } from '@/core/timelineitem/type'
import type { TextStyleConfig } from '@/core/timelineitem/texttype'
import type { UnifiedTimeRange } from '@/core/types/timeRange'
import { DEFAULT_TEXT_STYLE } from '@/core/timelineitem/texttype'
import { createDefaultMaskConfig } from '@/core/timelineitem/mask'
import { DEFAULT_BLEND_MODE } from '@/core/timelineitem'
import { createDefaultTimelineExtraRenderConfig } from '@/core/timelineitem/type'

/**
 * 统一架构下的文本时间轴工具函数
 * 提供文本项目的创建、管理和操作功能
 * 适配新的统一时间轴项目架构
 */

/**
 * 创建文本时间轴项目（统一架构）- 专注于可持久化数据
 *
 * 🏗️ 新架构特性：
 * - ✅ 使用 UnifiedTimelineItemData 类型
 * - ✅ 专注于可持久化保存的部分
 * - ✅ 支持动画配置
 * - ✅ 使用 UUID4 生成器
 * - ✅ 采用 3 状态管理（ready/loading/error）
 * - ✅ 不包含 sprite 生成逻辑，只创建配置信息
 *
 * @param text 文本内容
 * @param style 文本样式配置（部分）
 * @param startTimeFrames 开始时间（帧数）
 * @param trackId 轨道ID
 * @param duration 显示时长（帧数），默认150帧（5秒@30fps）
 * @param customId 自定义ID（可选）
 * @returns Promise<UnifiedTimelineItemData<'text'>> 统一架构的文本时间轴项目（不含sprite）
 */
export async function createTextTimelineItem(
  text: string,
  style: Partial<TextStyleConfig>,
  startTimeFrames: number,
  trackId: string,
  duration: number = 150,
  customId?: string,
): Promise<UnifiedTimelineItemData<'text'>> {
  console.log('🔄 [UnifiedTextTimelineUtils] 开始创建文本时间轴项目（可持久化部分）:', {
    text: text.substring(0, 20) + '...',
    startTimeFrames,
    trackId,
    duration,
  })

  // 1. 验证和补全文本样式
  const completeStyle: TextStyleConfig = {
    ...DEFAULT_TEXT_STYLE,
    ...style,
  }

  // 4. 创建时间范围配置
  const timeRange: UnifiedTimeRange = {
    timelineStartTime: startTimeFrames,
    timelineEndTime: startTimeFrames + duration,
    clipStartTime: -1, // 文本不使用此属性
    clipEndTime: -1, // 文本不使用此属性
  }

  // 5. 创建文本媒体配置（适配新架构）
  const textConfig: TextMediaConfig = {
    // 文本特有属性
    text,
    style: completeStyle,
    // 视觉属性（继承自 VisualMediaProps）
    x: 0,
    y: 0,
    width: 0, // 等待后续更新
    height: 0, // 等待后续更新
    rotation: 0,
    opacity: 1,
    blendMode: DEFAULT_BLEND_MODE,
    // 等比缩放状态（默认开启）
    proportionalScale: true,
    mask: createDefaultMaskConfig('rectangle', {
      width: completeStyle.maxWidth ?? completeStyle.fontSize * 6,
      height: completeStyle.fontSize * (completeStyle.lineHeight ?? 1.2),
    }),
  }

  // 6. 创建统一时间轴项目（使用新架构，不包含sprite）
  const timelineItem: UnifiedTimelineItemData<'text'> = reactive({
    id: customId || generateTimelineItemId(),
    mediaItemId: null, // 文本项目不需要媒体库项目，使用 null 表示无关联
    trackId,
    mediaType: 'text',
    timeRange,
    config: textConfig,
    exRenderConfig: createDefaultTimelineExtraRenderConfig(),
    animation: undefined, // 新创建的文本项目默认没有动画
    timelineStatus: 'ready', // 文本项目创建后即为就绪状态
    runtime: {
      // ✅ 文本项目不依赖外部媒体，直接完成初始化
      exRenderConfig: createDefaultTimelineExtraRenderConfig(),
      isInitialized: true,
      textBitmapVersion: 0,
    },
  })

  return timelineItem
}
