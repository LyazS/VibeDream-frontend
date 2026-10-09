import { timecodeToFrames } from '@/core/utils/timeUtils'
import { TimeConstants } from '@/constants/TimeConstants'

const AGENT_TOOL_TIMECODE_REGEX = /^(\d{2}):(\d{2}):(\d{2})\+(\d{2})$/

export function isValidAgentToolTimecode(timecode: string): boolean {
  if (!AGENT_TOOL_TIMECODE_REGEX.test(timecode)) {
    return false
  }

  const [, hours, minutes, seconds, frames] = timecode.match(AGENT_TOOL_TIMECODE_REGEX)!.map(Number)

  return (
    hours >= 0
    && minutes >= 0
    && minutes < 60
    && seconds >= 0
    && seconds < 60
    && frames >= 0
    && frames < TimeConstants.FRAME_RATE
  )
}

export function parseAgentToolTimecode(timecode: string): number {
  return timecodeToFrames(timecode)
}
