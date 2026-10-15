import { describe, expect, it } from 'vitest'
import { buildToolException } from '@/core/agent/tools/utils/result'
import { parseLibraryAssetMetaFile } from '@/core/project/metaTypes'

describe('media source persistence', () => {
  const meta = {
    version: '1.0',
    id: 'music.wav',
    name: 'music.wav',
    createdAt: '2026-10-15T00:00:00.000Z',
    assetKind: 'media',
    parentDirectoryId: 'root',
    mediaType: 'audio',
    mediaStatus: 'ready',
    source: { type: 'user-selected' },
    metadata: {
      musicAnalysis: {
        schemaVersion: 2,
        pipelineVersion: 'allinone-web-v2',
        analyzedAt: '2026-10-15T00:00:00.000Z',
        input: { durationSeconds: 120, sampleRate: 44_100 },
        bpm: 120,
        meter: 4,
        beats: [0, 0.5],
        downbeats: [0],
        beatPositions: [1, 2],
        segments: [{ start: 0, end: 120, label: 'verse' }],
        editingAnchors: [
          {
            id: 'anchor-1',
            time: 0,
            eventLabel: 'section_entry',
            roles: ['section_entry'],
            strength: 1,
          },
        ],
      },
    },
  }

  it('retains local music structure and editing anchors when reopening media', () => {
    expect(parseLibraryAssetMetaFile(meta)).toEqual(meta)
  })

  it('rejects retired generation sources instead of migrating them', () => {
    expect(() =>
      parseLibraryAssetMetaFile({ ...meta, source: { type: 'ai-generation' } }),
    ).toThrow()
  })
})

describe('tool exception responses', () => {
  it.each([
    [new Error('failed'), 'failed'],
    ['failed', 'failed'],
    [null, 'null'],
  ])('serializes thrown values without requiring an Error object %#', (error, message) => {
    const result = buildToolException('update_item', error)
    expect(result.success).toBe(false)
    expect(result.error).toBe(message)
    expect(JSON.parse(result.output)).toEqual({
      tool: 'update_item',
      error: message,
      code: 'internal_error',
    })
  })

  it('preserves a domain error code and details while retaining the error string', () => {
    const details = {
      current: { itemId: 'media_take01.mp4', name: '镜头', parentDirId: 'dir_root' },
    }
    const error = Object.assign(new Error('项目状态已变化'), {
      toolCode: 'state_mismatch',
      toolDetails: details,
    })
    const result = buildToolException('rename_library_item', error)
    expect(result.success).toBe(false)
    expect(result.error).toBe('项目状态已变化')
    expect(JSON.parse(result.output)).toEqual({
      tool: 'rename_library_item',
      error: '项目状态已变化',
      code: 'state_mismatch',
      details,
    })
  })
})
