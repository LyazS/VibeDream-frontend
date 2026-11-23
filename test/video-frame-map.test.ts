import { describe, expect, it, vi } from 'vitest'
import { VideoFrameMap } from '@/core/mediabunny/VideoFrameMap'
import type { FrameData } from '@/core/webgl2/types'

function createVideoSample() {
  return {
    close: vi.fn(),
  } as unknown as FrameData['videoSample']
}

function createFrame(frameNumber: number, videoSample = createVideoSample()): FrameData {
  return {
    timeRange: {
      timelineStartTime: 0,
      timelineEndTime: 90,
      clipStartTime: 0,
      clipEndTime: 90,
    },
    frameNumber,
    clockwiseRotation: 0,
    videoSample,
  }
}

describe('VideoFrameMap', () => {
  it('替换同一个 item 的帧时关闭旧 VideoSample', () => {
    const frameMap = new VideoFrameMap()
    const oldSample = createVideoSample()
    const newFrame = createFrame(2)

    frameMap.set('item-1', createFrame(1, oldSample))
    frameMap.set('item-1', newFrame)

    expect(oldSample.close).toHaveBeenCalledTimes(1)
    expect(frameMap.get('item-1')).toBe(newFrame)
  })

  it('重复写入同一个 VideoSample 时不提前关闭', () => {
    const frameMap = new VideoFrameMap()
    const sample = createVideoSample()

    frameMap.set('item-1', createFrame(1, sample))
    frameMap.set('item-1', createFrame(2, sample))

    expect(sample.close).not.toHaveBeenCalled()
    expect(frameMap.get('item-1')?.frameNumber).toBe(2)
  })

  it('写入新 item 时保留其他 item 不变', () => {
    const frameMap = new VideoFrameMap()
    const existingSample = createVideoSample()
    const existingFrame = createFrame(1, existingSample)
    const newFrame = createFrame(2)

    frameMap.set('item-1', existingFrame)
    frameMap.set('item-2', newFrame)

    expect(existingSample.close).not.toHaveBeenCalled()
    expect(frameMap.get('item-1')).toBe(existingFrame)
    expect(frameMap.get('item-2')).toBe(newFrame)
  })

  it('删除帧时关闭并移除对应对象', () => {
    const frameMap = new VideoFrameMap()
    const sample = createVideoSample()

    frameMap.set('item-1', createFrame(1, sample))

    expect(frameMap.delete('item-1')).toBe(true)
    expect(sample.close).toHaveBeenCalledTimes(1)
    expect(frameMap.has('item-1')).toBe(false)
    expect(frameMap.delete('item-1')).toBe(false)
    expect(sample.close).toHaveBeenCalledTimes(1)
  })

  it('清空 Map 时关闭全部帧', () => {
    const frameMap = new VideoFrameMap()
    const firstSample = createVideoSample()
    const secondSample = createVideoSample()

    frameMap.set('item-1', createFrame(1, firstSample))
    frameMap.set('item-2', createFrame(2, secondSample))
    frameMap.clear()

    expect(firstSample.close).toHaveBeenCalledTimes(1)
    expect(secondSample.close).toHaveBeenCalledTimes(1)
    expect(frameMap.size).toBe(0)
  })

  it('保留指定 item 并关闭被清理的帧', () => {
    const frameMap = new VideoFrameMap()
    const keptSample = createVideoSample()
    const removedSample = createVideoSample()

    frameMap.set('item-1', createFrame(1, keptSample))
    frameMap.set('item-2', createFrame(2, removedSample))
    frameMap.retain(new Set(['item-1']))

    expect(frameMap.has('item-1')).toBe(true)
    expect(frameMap.has('item-2')).toBe(false)
    expect(keptSample.close).not.toHaveBeenCalled()
    expect(removedSample.close).toHaveBeenCalledTimes(1)
  })

  it('保留空集合时清理全部帧', () => {
    const frameMap = new VideoFrameMap()
    const firstSample = createVideoSample()
    const secondSample = createVideoSample()

    frameMap.set('item-1', createFrame(1, firstSample))
    frameMap.set('item-2', createFrame(2, secondSample))
    frameMap.retain(new Set())

    expect(firstSample.close).toHaveBeenCalledTimes(1)
    expect(secondSample.close).toHaveBeenCalledTimes(1)
    expect(frameMap.size).toBe(0)
  })

  it('保持 Map 的查询、size 和遍历行为', () => {
    const frameMap = new VideoFrameMap()
    const firstFrame = createFrame(1)
    const secondFrame = createFrame(2)

    frameMap.set('item-1', firstFrame)
    frameMap.set('item-2', secondFrame)

    expect(frameMap.get('item-1')).toBe(firstFrame)
    expect(frameMap.has('item-2')).toBe(true)
    expect(frameMap.size).toBe(2)
    expect([...frameMap.keys()]).toEqual(['item-1', 'item-2'])
    expect([...frameMap.values()]).toEqual([firstFrame, secondFrame])
  })
})
