import { describe, expect, it } from 'vitest'
import {
  expandAsrRange,
  isRangeCovered,
  mergeAsrResult,
  segmentsForRange,
} from '@/core/asr/cache'

describe('ASR range cache', () => {
  it('expands a requested range with bounded context', () => {
    expect(expandAsrRange({ start_ms: 10_000, end_ms: 50_000 }, 60_000)).toEqual({
      start_ms: 8_000,
      end_ms: 52_000,
    })
    expect(expandAsrRange({ start_ms: 59_000, end_ms: 60_000 }, 60_000)).toEqual({
      start_ms: 57_000,
      end_ms: 60_000,
    })
  })

  it('replaces segments inside a completed recognition range', () => {
    const next = mergeAsrResult(
      {
        completedRanges: [{ start_ms: 0, end_ms: 10_000 }],
        segments: [
          { start_ms: 1_000, end_ms: 2_000, text: '旧内容' },
          { start_ms: 12_000, end_ms: 13_000, text: '保留内容' },
        ],
        tasks: [],
      },
      { start_ms: 0, end_ms: 10_000 },
      [{ start_ms: 2_000, end_ms: 3_000, text: '新内容' }],
    )
    expect(next.segments.map((segment) => segment.text)).toEqual(['新内容', '保留内容'])
    expect(isRangeCovered(next, { start_ms: 1_000, end_ms: 9_000 })).toBe(true)
  })

  it('clips cached segments to the requested range', () => {
    expect(
      segmentsForRange(
        [{ start_ms: 8_000, end_ms: 12_000, text: '一句话' }],
        { start_ms: 10_000, end_ms: 11_000 },
      ),
    ).toEqual([{ start_ms: 10_000, end_ms: 11_000, text: '一句话' }])
  })
})
