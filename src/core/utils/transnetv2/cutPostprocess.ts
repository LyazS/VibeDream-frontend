import { TRANSNETV2_DEFAULT_MIN_SHOT_FRAMES, TRANSNETV2_DEFAULT_THRESHOLD } from './types'

interface CutPostprocessConfig {
  threshold?: number
  minShotFrames?: number
  startFrame: bigint
  totalFrames: number
}

interface CandidateRegion {
  start: number
  end: number
}

function collectCandidateRegions(probabilities: number[], threshold: number): CandidateRegion[] {
  const regions: CandidateRegion[] = []
  let regionStart: number | null = null

  for (let index = 0; index < probabilities.length; index++) {
    if (probabilities[index] >= threshold) {
      regionStart ??= index
      continue
    }

    if (regionStart !== null) {
      regions.push({ start: regionStart, end: index - 1 })
      regionStart = null
    }
  }

  if (regionStart !== null) {
    regions.push({ start: regionStart, end: probabilities.length - 1 })
  }

  return regions
}

export function probabilitiesToTimelineCutFrames(
  probabilities: number[],
  config: CutPostprocessConfig,
): bigint[] {
  const threshold = config.threshold ?? TRANSNETV2_DEFAULT_THRESHOLD
  const minShotFrames = config.minShotFrames ?? TRANSNETV2_DEFAULT_MIN_SHOT_FRAMES
  const regions = collectCandidateRegions(probabilities, threshold)
  const cuts: bigint[] = []
  let previousCutFrame = 0

  for (const region of regions) {
    const cutFrame = Math.round((region.start + region.end) / 2)

    if (cutFrame <= 0 || cutFrame >= config.totalFrames - 1) {
      continue
    }

    if (cutFrame - previousCutFrame < minShotFrames) {
      continue
    }

    if (config.totalFrames - cutFrame < minShotFrames) {
      continue
    }

    cuts.push(config.startFrame + BigInt(cutFrame))
    previousCutFrame = cutFrame
  }

  return cuts
}
