/**
 * ASR 字幕拆分工具
 * 使用双指针法检测标点符号，将长句拆分为适合字幕的短句
 */

import type { ASRUtterance, ASRWord } from '@/core/datasource/providers/asr/types'

/**
 * 拆分后的字幕片段
 */
export interface SplitSubtitle {
  text: string
  start_time: number // 毫秒
  end_time: number   // 毫秒
}

/**
 * 字幕拆分配置
 */
export interface SubtitleSplitConfig {
  maxChars: number      // 单条字幕最大字数（超过则强制拆分）
  maxDuration: number   // 单条字幕最大时长（毫秒，超过则强制拆分）
  minChars: number      // 单条字幕最小字数（少于此数量不拆分）
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: SubtitleSplitConfig = {
  maxChars: 20,       // 最大 20 字
  maxDuration: 5000,  // 最大 5 秒
  minChars: 2,        // 最小 2 字
}

/**
 * 将 ASR utterance 拆分为适合字幕的短句
 * 使用双指针法检测标点符号
 * 
 * @param utterance 原始 utterance
 * @param config 拆分配置
 * @returns 拆分后的字幕数组
 */
export function splitUtteranceToSubtitles(
  utterance: ASRUtterance,
  config: Partial<SubtitleSplitConfig> = {},
): SplitSubtitle[] {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const { text, words, start_time, end_time } = utterance

  // 如果没有 words 信息，无法拆分，直接返回原始数据
  if (!words || words.length === 0) {
    return [{ text, start_time, end_time }]
  }

  // 使用双指针法找到所有拆分点
  const splitPoints = findSplitPoints(text, words, cfg)

  // 根据拆分点生成字幕片段
  return generateSubtitlesFromSplitPoints(splitPoints, words, start_time, end_time)
}

/**
 * 使用双指针法找到所有拆分点
 * 
 * @param text 完整文本
 * @param words words 数组
 * @param config 配置
 * @returns 拆分点数组（每个拆分点表示在该 word 索引之后拆分）
 */
function findSplitPoints(
  text: string,
  words: ASRWord[],
  config: SubtitleSplitConfig,
): number[] {
  const splitPoints: number[] = []
  
  let textIndex = 0
  let wordIndex = 0
  let charInWordIndex = 0
  
  // 当前累积的字符数（用于强制拆分）
  let accumulatedChars = 0
  // 当前累积的起始 word 索引
  let segmentStartWordIndex = 0

  while (textIndex < text.length && wordIndex < words.length) {
    const currentChar = text[textIndex]
    const currentWord = words[wordIndex]
    const currentWordChar = currentWord.text[charInWordIndex]

    if (currentChar === currentWordChar) {
      // 字符匹配，继续
      textIndex++
      charInWordIndex++
      accumulatedChars++

      // 如果当前 word 匹配完了，移动到下一个 word
      if (charInWordIndex >= currentWord.text.length) {
        wordIndex++
        charInWordIndex = 0
      }
    } else {
      // 字符不匹配，说明遇到了标点符号
      // 在当前 word 之前拆分（因为标点不属于任何 word）
      
      // 只有当累积的字符数满足最小要求时才拆分
      if (accumulatedChars >= config.minChars) {
        splitPoints.push(wordIndex - 1) // 在前一个 word 之后拆分
        accumulatedChars = 0
        segmentStartWordIndex = wordIndex
      }
      
      // 跳过标点符号
      textIndex++
    }

    // 检查是否需要强制拆分（超过最大字数）
    if (accumulatedChars >= config.maxChars) {
      splitPoints.push(wordIndex)
      accumulatedChars = 0
      segmentStartWordIndex = wordIndex + 1
    }
  }

  return splitPoints
}

/**
 * 根据拆分点生成字幕片段
 * 
 * @param splitPoints 拆分点数组
 * @param words words 数组
 * @param startTime utterance 开始时间
 * @param endTime utterance 结束时间
 * @returns 字幕片段数组
 */
function generateSubtitlesFromSplitPoints(
  splitPoints: number[],
  words: ASRWord[],
  startTime: number,
  endTime: number,
): SplitSubtitle[] {
  const subtitles: SplitSubtitle[] = []

  // 如果没有拆分点，返回整个 utterance
  if (splitPoints.length === 0) {
    return [{
      text: words.map(w => w.text).join(''),
      start_time: startTime,
      end_time: endTime,
    }]
  }

  // 添加起始和结束边界
  const boundaries = [-1, ...splitPoints, words.length - 1]

  for (let i = 0; i < boundaries.length - 1; i++) {
    const startWordIndex = boundaries[i] + 1
    const endWordIndex = boundaries[i + 1]

    if (startWordIndex > endWordIndex || startWordIndex >= words.length) {
      continue
    }

    const segmentWords = words.slice(startWordIndex, endWordIndex + 1)
    
    // 跳过空的片段
    if (segmentWords.length === 0) {
      continue
    }

    const subtitle: SplitSubtitle = {
      text: segmentWords.map(w => w.text).join(''),
      start_time: segmentWords[0].start_time,
      end_time: segmentWords[segmentWords.length - 1].end_time,
    }

    subtitles.push(subtitle)
  }

  return subtitles
}

/**
 * 批量处理多个 utterances
 * 
 * @param utterances utterances 数组
 * @param config 拆分配置
 * @returns 拆分后的字幕数组
 */
export function splitAllUtterancesToSubtitles(
  utterances: ASRUtterance[],
  config: Partial<SubtitleSplitConfig> = {},
): SplitSubtitle[] {
  const allSubtitles: SplitSubtitle[] = []

  for (const utterance of utterances) {
    const subtitles = splitUtteranceToSubtitles(utterance, config)
    allSubtitles.push(...subtitles)
  }

  return allSubtitles
}
