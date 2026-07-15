/**
 * 文本类型定义
 * 包含文本样式相关的类型和常量
 */
export interface TextStyleConfig {
  // 基础字体属性
  fontSize: number
  fontFamily: string
  fontWeight: string | number
  fontStyle: 'normal' | 'italic'
  // 颜色属性
  color: string
  backgroundColor?: string
  // 文本效果
  textShadow?: string
  textStroke?: {
    // 文字描边
    width: number
    color: string
  }
  textGlow?: {
    // 文字发光
    color: string
    blur: number
    spread?: number
  }
  // 布局属性
  textAlign: 'left' | 'center' | 'right'
  lineHeight?: number
  maxWidth?: number
  // 自定义字体
  customFont?: {
    name: string
    url: string
  }
}

/**
 * 默认文本样式配置
 */
export const DEFAULT_TEXT_STYLE: TextStyleConfig = {
  fontSize: 48,
  fontFamily: 'Arial, sans-serif',
  fontWeight: 'normal',
  fontStyle: 'normal',
  color: '#ffffff',
  textAlign: 'center',
  lineHeight: 1.2,
}
