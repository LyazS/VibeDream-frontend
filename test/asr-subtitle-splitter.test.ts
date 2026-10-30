import { describe, expect, it } from 'vitest'
import { splitAsrSegment, splitAsrSegments } from '@/core/asr/subtitleSplitter'

function words(text: string, start = 0, step = 100): Array<{ start_ms: number; end_ms: number; text: string }> {
  return Array.from(text).map((character, index) => ({
    start_ms: start + index * step,
    end_ms: start + (index + 1) * step,
    text: character,
  }))
}

describe('ASR subtitle splitter', () => {
  it('splits at punctuation and removes punctuation from subtitle text', () => {
    const result = splitAsrSegment({
      text: '这是字节跳动，今日头条母公司。',
      start_ms: 0,
      end_ms: 1_600,
      words: words('这是字节跳动今日头条母公司', 0, 100),
    })

    expect(result).toEqual([
      { text: '这是字节跳动', start_ms: 0, end_ms: 600 },
      { text: '今日头条母公司', start_ms: 600, end_ms: 1_300 },
    ])
  })

  it('keeps a segment at the 40 character limit', () => {
    const text = '甲'.repeat(40)
    const result = splitAsrSegment({ text, start_ms: 0, end_ms: 4_000, words: words(text) })

    expect(result).toEqual([{ text, start_ms: 0, end_ms: 4_000 }])
  })

  it('splits before adding the character that would exceed 40', () => {
    const text = '甲'.repeat(41)
    const result = splitAsrSegment({ text, start_ms: 0, end_ms: 4_100, words: words(text) })

    expect(result).toHaveLength(2)
    expect(result[0].text).toHaveLength(40)
    expect(result[1].text).toHaveLength(1)
  })

  it('does not create a one character subtitle at a punctuation boundary', () => {
    const result = splitAsrSegment({
      text: '好，世界。',
      start_ms: 0,
      end_ms: 500,
      words: words('好世界', 0, 100),
    })

    expect(result).toEqual([{ text: '好世界', start_ms: 0, end_ms: 300 }])
  })

  it('uses proportional timing when words are unavailable', () => {
    const result = splitAsrSegment({
      text: '甲乙丙，丁戊。',
      start_ms: 1_000,
      end_ms: 2_000,
    })

    expect(result).toEqual([
      { text: '甲乙丙', start_ms: 1_000, end_ms: 1_600 },
      { text: '丁戊', start_ms: 1_600, end_ms: 2_000 },
    ])
  })

  it('splits a long text-only result at the hard limit', () => {
    const result = splitAsrSegment({
      text: '甲'.repeat(41),
      start_ms: 0,
      end_ms: 4_100,
    })

    expect(result.map((item) => item.text.length)).toEqual([40, 1])
    expect(result[0].start_ms).toBe(0)
    expect(result.at(-1)?.end_ms).toBe(4_100)
  })

  it('preserves segment order when splitting multiple ASR segments', () => {
    const result = splitAsrSegments([
      { text: '甲。', start_ms: 0, end_ms: 100, words: words('甲') },
      { text: '乙。', start_ms: 200, end_ms: 300, words: words('乙', 200) },
    ])

    expect(result.map((item) => item.text)).toEqual(['甲', '乙'])
  })
})
