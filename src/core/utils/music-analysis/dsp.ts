import { wasmManifest } from '@/generated/model-manifest'
import { resolveAssetUrl } from '@/config/runtimeConfig'
import type { AcousticEvent } from './types'

export const DEMUCS_SEGMENT_SAMPLES = 343_980
export const DEMUCS_STFT_LENGTH = 2 * 2_048 * 336 * 2
export const DEMUCS_COMPLEX_STEMS_LENGTH = 4 * 2 * 2_048 * 336 * 2
export const DEMUCS_TIME_STEMS_LENGTH = 4 * 2 * DEMUCS_SEGMENT_SAMPLES

const DEMUCS_OVERLAP = 0.25
const FEATURE_BANDS = 81
const ACOUSTIC_RECORD_WIDTH = 7

interface DspWasmExports {
  memory: WebAssembly.Memory
  engine_init(sampleCount: number): number
  engine_reset(): void
  engine_input_ptr(): number
  engine_chunk_ptr(): number
  engine_stft_ptr(): number
  engine_complex_stems_ptr(): number
  engine_time_stems_ptr(): number
  engine_features_ptr(): number
  engine_activations_ptr(): number
  engine_decoded_beats_ptr(): number
  engine_decoded_positions_ptr(): number
  engine_decoded_count(): number
  engine_decoded_meter(): number
  engine_acoustic_events_ptr(): number
  engine_acoustic_events_count(): number
  engine_normalize(): number
  engine_prepare_segment(offset: number, currentLength: number): number
  engine_combine_segment(offset: number, currentLength: number): number
  engine_extract_features(): number
  engine_decode_downbeats(frameCount: number): number
  engine_detect_acoustics(): number
}

let runtime: Promise<DspWasmExports> | undefined

async function loadRuntime(): Promise<DspWasmExports> {
  if (!runtime) {
    runtime = (async () => {
      const response = await fetch(resolveAssetUrl(wasmManifest.dsp.path))
      if (!response.ok) throw new Error(`无法加载音乐分析 DSP Wasm (${response.status})`)
      const bytes = await response.arrayBuffer()
      const { instance } = await WebAssembly.instantiate(bytes)
      const exports = instance.exports as unknown as DspWasmExports
      if (!(exports.memory instanceof WebAssembly.Memory)) {
        throw new Error('音乐分析 DSP Wasm 未导出内存')
      }
      if (
        typeof exports.engine_detect_acoustics !== 'function' ||
        typeof exports.engine_acoustic_events_ptr !== 'function' ||
        typeof exports.engine_acoustic_events_count !== 'function'
      ) {
        throw new Error('音乐分析 DSP Wasm 未包含声学事件导出，请重新构建')
      }
      return exports
    })()
  }
  return runtime
}

function requireSuccess(result: number, operation: string): void {
  if (result !== 1) throw new Error(`音乐分析 DSP 无法${operation}`)
}

export interface DecodedDownbeats {
  beats: number[]
  positions: number[]
  meter: number
}

export class WasmDspEngine {
  readonly length: number
  readonly segmentStride: number
  private disposed = false

  private constructor(
    private readonly wasm: DspWasmExports,
    length: number,
  ) {
    this.length = length
    this.segmentStride = Math.trunc((1 - DEMUCS_OVERLAP) * DEMUCS_SEGMENT_SAMPLES)
  }

  static async create(channels: Float32Array): Promise<WasmDspEngine> {
    if (channels.length === 0 || channels.length % 2 !== 0) {
      throw new Error('音乐分析需要非空双声道 PCM')
    }
    const wasm = await loadRuntime()
    const length = channels.length / 2
    requireSuccess(wasm.engine_init(length), '分配音频工作区')
    const engine = new WasmDspEngine(wasm, length)
    try {
      engine.view(wasm.engine_input_ptr(), channels.length).set(channels)
      requireSuccess(wasm.engine_normalize(), '归一化音频')
      return engine
    } catch (error) {
      engine.dispose()
      throw error
    }
  }

  get segmentCount(): number {
    return Math.ceil(this.length / this.segmentStride)
  }

  prepareSegment(index: number): {
    mix: Float32Array
    stft: Float32Array
    offset: number
    currentLength: number
  } {
    this.assertActive()
    if (!Number.isInteger(index) || index < 0 || index >= this.segmentCount) {
      throw new Error(`无效的 Demucs 分段: ${index}`)
    }
    const offset = index * this.segmentStride
    const currentLength = Math.min(this.length - offset, DEMUCS_SEGMENT_SAMPLES)
    requireSuccess(this.wasm.engine_prepare_segment(offset, currentLength), '准备 Demucs 分段')
    return {
      mix: this.view(this.wasm.engine_chunk_ptr(), 2 * DEMUCS_SEGMENT_SAMPLES),
      stft: this.view(this.wasm.engine_stft_ptr(), DEMUCS_STFT_LENGTH),
      offset,
      currentLength,
    }
  }

  combineSegment(
    offset: number,
    currentLength: number,
    complexStems: Float32Array,
    timeStems: Float32Array,
  ): void {
    this.assertActive()
    if (
      complexStems.length !== DEMUCS_COMPLEX_STEMS_LENGTH ||
      timeStems.length !== DEMUCS_TIME_STEMS_LENGTH
    ) {
      throw new Error('HTDemucs 输出形状无效')
    }
    this.view(this.wasm.engine_complex_stems_ptr(), DEMUCS_COMPLEX_STEMS_LENGTH).set(complexStems)
    this.view(this.wasm.engine_time_stems_ptr(), DEMUCS_TIME_STEMS_LENGTH).set(timeStems)
    requireSuccess(this.wasm.engine_combine_segment(offset, currentLength), '合并 Demucs 分段')
  }

  extractFeatures(): Float32Array {
    this.assertActive()
    requireSuccess(this.wasm.engine_extract_features(), '提取 Harmonix 特征')
    return this.view(
      this.wasm.engine_features_ptr(),
      4 * Math.ceil(this.length / 441) * FEATURE_BANDS,
    )
  }

  decodeDownbeats(activations: Float32Array): DecodedDownbeats {
    this.assertActive()
    if (activations.length % 2 !== 0 || activations.length / 2 > Math.ceil(this.length / 441)) {
      throw new Error('节拍激活形状无效')
    }
    const frameCount = activations.length / 2
    this.view(this.wasm.engine_activations_ptr(), activations.length).set(activations)
    requireSuccess(this.wasm.engine_decode_downbeats(frameCount), '解码节拍')
    const count = this.wasm.engine_decoded_count()
    if (count === 0) return { beats: [], positions: [], meter: this.wasm.engine_decoded_meter() }
    return {
      beats: Array.from(this.float64View(this.wasm.engine_decoded_beats_ptr(), count)),
      positions: Array.from(this.uint8View(this.wasm.engine_decoded_positions_ptr(), count)),
      meter: this.wasm.engine_decoded_meter(),
    }
  }

  detectAcousticEvents(): AcousticEvent[] {
    this.assertActive()
    requireSuccess(this.wasm.engine_detect_acoustics(), '检测声学事件')
    const count = this.wasm.engine_acoustic_events_count()
    if (count === 0) return []

    const values = this.view(
      this.wasm.engine_acoustic_events_ptr(),
      count * ACOUSTIC_RECORD_WIDTH,
    )
    const events: AcousticEvent[] = []
    for (let index = 0; index < count; index += 1) {
      const offset = index * ACOUSTIC_RECORD_WIDTH
      const time = values[offset]!
      const score = values[offset + 1]!
      const a = values[offset + 2]!
      const b = values[offset + 3]!
      const c = values[offset + 4]!
      const d = values[offset + 5]!
      const kind = Math.round(values[offset + 6]!)
      const event = acousticDefinition(kind, time, score, a, b, c, d)
      if (event) events.push(event)
    }
    return events
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.wasm.engine_reset()
  }

  private view(pointer: number, length: number): Float32Array {
    this.assertMemoryView(pointer, length, Float32Array.BYTES_PER_ELEMENT)
    return new Float32Array(this.wasm.memory.buffer, pointer, length)
  }

  private float64View(pointer: number, length: number): Float64Array {
    this.assertMemoryView(pointer, length, Float64Array.BYTES_PER_ELEMENT)
    return new Float64Array(this.wasm.memory.buffer, pointer, length)
  }

  private uint8View(pointer: number, length: number): Uint8Array {
    this.assertMemoryView(pointer, length, Uint8Array.BYTES_PER_ELEMENT)
    return new Uint8Array(this.wasm.memory.buffer, pointer, length)
  }

  private assertMemoryView(pointer: number, length: number, elementSize: number): void {
    if (pointer <= 0 || pointer + length * elementSize > this.wasm.memory.buffer.byteLength) {
      throw new Error('音乐分析 DSP 返回了无效内存视图')
    }
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('音乐分析 DSP 已释放')
  }
}

export function featureShape(length: number): [number, number, number, number] {
  return [1, 4, Math.ceil(length / 441), FEATURE_BANDS]
}

function acousticDefinition(
  kind: number,
  time: number,
  score: number,
  a: number,
  b: number,
  c: number,
  d: number,
): AcousticEvent | null {
  const common = {
    time: Math.round(time * 1000) / 1000,
    score: Math.round(score * 1000) / 1000,
    detector: 'lightcut-acoustic-wasm-v1',
  }

  if (kind >= 0 && kind <= 2) {
    const labels = ['energy_rise', 'energy_fall', 'energy_peak'] as const
    const eventLabel = labels[kind]!
    return {
      ...common,
      source: 'energy_change',
      eventLabel,
      signals: {
        energyDb: a,
        energyDeltaDb: b,
        energyTrend: eventLabel === 'energy_rise' ? 'rising' : eventLabel === 'energy_fall' ? 'falling' : 'peak',
      },
    }
  }

  if (kind >= 3 && kind <= 5) {
    const labels = ['onset_event', 'onset_entry', 'onset_exit'] as const
    const eventLabel = labels[kind - 3]!
    return {
      ...common,
      source: 'onset_change',
      eventLabel,
      signals: {
        onsetStrength: a,
        spectralFlux: b,
        melFlux: c,
        hfcStrength: d,
        onsetDirection: eventLabel === 'onset_entry' ? 'entering' : eventLabel === 'onset_exit' ? 'exiting' : 'event',
      },
    }
  }

  if (kind === 6 || kind === 7) {
    return {
      ...common,
      source: 'silence',
      eventLabel: kind === 6 ? 'silence_enter' : 'silence_exit',
      signals: {
        silenceDb: a,
        silenceDurationMs: b,
        silenceThresholdDb: c,
        silenceKind: d === 0 ? 'hard_silence' : 'near_silence',
        direction: kind === 6 ? 'entering' : 'exiting',
      },
    }
  }

  if (kind >= 8 && kind <= 11) {
    const labels = ['pitch_rise', 'pitch_fall', 'pitch_entry', 'pitch_exit'] as const
    return {
      ...common,
      source: 'pitch_change',
      eventLabel: labels[kind - 8]!,
      signals: {
        f0Hz: a,
        pitchDeltaSemitones: b,
        pitchConfidence: c,
        voiced: d > 0.5,
      },
    }
  }

  return null
}
