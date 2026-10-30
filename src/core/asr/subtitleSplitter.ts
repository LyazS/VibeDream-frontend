import type { AsrSegment } from './types'

export interface SubtitleSplitConfig {
  maxChars: number
  minChars: number
}

export interface SubtitleSegment {
  start_ms: number
  end_ms: number
  text: string
}

export const DEFAULT_SUBTITLE_SPLIT_CONFIG: SubtitleSplitConfig = {
  maxChars: 40,
  minChars: 2,
}

const PUNCTUATION = /^\p{P}$/u

function isPunctuation(value: string): boolean {
  return PUNCTUATION.test(value)
}

function visibleText(value: string): string {
  return Array.from(value)
    .filter((character) => !isPunctuation(character))
    .join('')
}

function characterCount(value: string): number {
  return Array.from(value).length
}

function normalizedConfig(config: Partial<SubtitleSplitConfig>): SubtitleSplitConfig {
  const maxChars = Number.isFinite(config.maxChars)
    ? Math.max(1, Math.floor(config.maxChars as number))
    : DEFAULT_SUBTITLE_SPLIT_CONFIG.maxChars
  const minChars = Number.isFinite(config.minChars)
    ? Math.max(1, Math.min(maxChars, Math.floor(config.minChars as number)))
    : Math.min(DEFAULT_SUBTITLE_SPLIT_CONFIG.minChars, maxChars)
  return { maxChars, minChars }
}

function validTimeRange(start_ms: number, end_ms: number): boolean {
  return Number.isFinite(start_ms) && Number.isFinite(end_ms) && end_ms > start_ms
}

function splitText(text: string, maxChars: number): string[] {
  const characters = Array.from(text)
  const parts: string[] = []
  for (let index = 0; index < characters.length; index += maxChars) {
    parts.push(characters.slice(index, index + maxChars).join(''))
  }
  return parts
}

function splitOversizedWord(
  word: { start_ms: number; end_ms: number; text: string },
  config: SubtitleSplitConfig,
): SubtitleSegment[] {
  const text = visibleText(word.text)
  const parts = splitText(text, config.maxChars)
  const duration = word.end_ms - word.start_ms
  const totalChars = characterCount(text)
  let consumedChars = 0

  return parts.map((part) => {
    const start_ms = word.start_ms + Math.round((consumedChars / totalChars) * duration)
    consumedChars += characterCount(part)
    const end_ms = word.start_ms + Math.round((consumedChars / totalChars) * duration)
    return { start_ms, end_ms: Math.max(start_ms + 1, end_ms), text: part }
  })
}

function findPunctuationBoundaries(text: string, words: AsrSegment['words']): Set<number> {
  const boundaries = new Set<number>()
  if (!words?.length) return boundaries

  const normalizedWords = words.map((word) => visibleText(word.text))
  let wordIndex = 0
  let charIndex = 0

  for (const character of Array.from(text)) {
    while (wordIndex < normalizedWords.length && charIndex >= normalizedWords[wordIndex].length) {
      wordIndex += 1
      charIndex = 0
    }
    if (isPunctuation(character)) {
      if (wordIndex > 0 && charIndex === 0) boundaries.add(wordIndex - 1)
      continue
    }
    if (/\s/u.test(character)) continue

    if (wordIndex >= normalizedWords.length) continue

    charIndex += 1
  }

  if (wordIndex >= normalizedWords.length && normalizedWords.length > 0) {
    const characters = Array.from(text)
    const lastCharacter = characters[characters.length - 1]
    if (lastCharacter && isPunctuation(lastCharacter)) boundaries.add(normalizedWords.length - 1)
  }

  return boundaries
}

function splitTimedSegment(segment: AsrSegment, config: SubtitleSplitConfig): SubtitleSegment[] {
  const words = (segment.words ?? []).filter(
    (word) => validTimeRange(word.start_ms, word.end_ms) && visibleText(word.text),
  )
  if (!words.length) return splitTextOnlySegment(segment, config)

  const punctuationBoundaries = findPunctuationBoundaries(segment.text, words)
  const subtitles: SubtitleSegment[] = []
  let currentWords: Array<{ start_ms: number; end_ms: number; text: string }> = []
  let currentChars = 0

  const emitCurrent = (force = false) => {
    if (!currentWords.length || (!force && currentChars < config.minChars)) return
    subtitles.push({
      start_ms: currentWords[0].start_ms,
      end_ms: currentWords[currentWords.length - 1].end_ms,
      text: currentWords.map((word) => visibleText(word.text)).join(''),
    })
    currentWords = []
    currentChars = 0
  }

  words.forEach((word, index) => {
    const text = visibleText(word.text)
    const count = characterCount(text)

    if (count > config.maxChars) {
      emitCurrent(true)
      subtitles.push(...splitOversizedWord({ ...word, text }, config))
    } else {
      if (currentWords.length && currentChars + count > config.maxChars) emitCurrent(true)
      currentWords.push({ ...word, text })
      currentChars += count
    }

    if (punctuationBoundaries.has(index)) emitCurrent()
  })

  emitCurrent(true)
  return subtitles
}

function splitTextOnlySegment(segment: AsrSegment, config: SubtitleSplitConfig): SubtitleSegment[] {
  const chunks: string[] = []
  let current = ''
  for (const character of Array.from(segment.text)) {
    if (isPunctuation(character)) {
      const trimmed = current.trim()
      if (trimmed) chunks.push(trimmed)
      current = ''
    } else {
      current += character
    }
  }
  const trailing = current.trim()
  if (trailing) chunks.push(trailing)

  const mergedChunks: string[] = []
  let pendingShortChunk = ''
  for (const chunk of chunks) {
    if (!pendingShortChunk) {
      if (characterCount(chunk) < config.minChars) pendingShortChunk = chunk
      else mergedChunks.push(chunk)
      continue
    }

    const shortChunk = pendingShortChunk
    const combined = shortChunk + chunk
    pendingShortChunk = ''
    if (characterCount(combined) <= config.maxChars) {
      if (characterCount(combined) < config.minChars) pendingShortChunk = combined
      else mergedChunks.push(combined)
    } else {
      mergedChunks.push(shortChunk)
      if (characterCount(chunk) < config.minChars) pendingShortChunk = chunk
      else mergedChunks.push(chunk)
    }
  }
  if (pendingShortChunk) {
    const previous = mergedChunks[mergedChunks.length - 1]
    if (previous && characterCount(previous) + characterCount(pendingShortChunk) <= config.maxChars) {
      mergedChunks[mergedChunks.length - 1] = previous + pendingShortChunk
    } else {
      mergedChunks.push(pendingShortChunk)
    }
  }

  const parts = mergedChunks.flatMap((chunk) => splitText(chunk, config.maxChars))
  if (!parts.length || !validTimeRange(segment.start_ms, segment.end_ms)) return []

  const totalChars = parts.reduce((total, part) => total + characterCount(part), 0)
  const duration = segment.end_ms - segment.start_ms
  let consumedChars = 0
  return parts.map((part) => {
    const start_ms = segment.start_ms + Math.round((consumedChars / totalChars) * duration)
    consumedChars += characterCount(part)
    const end_ms = segment.start_ms + Math.round((consumedChars / totalChars) * duration)
    return { start_ms, end_ms: Math.max(start_ms + 1, end_ms), text: part }
  })
}

export function splitAsrSegment(
  segment: AsrSegment,
  config: Partial<SubtitleSplitConfig> = {},
): SubtitleSegment[] {
  const normalized = normalizedConfig(config)
  return splitTimedSegment(segment, normalized)
}

export function splitAsrSegments(
  segments: AsrSegment[],
  config: Partial<SubtitleSplitConfig> = {},
): SubtitleSegment[] {
  const normalized = normalizedConfig(config)
  return segments.flatMap((segment) => splitTimedSegment(segment, normalized))
}
