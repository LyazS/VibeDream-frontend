<template>
  <section v-if="shouldShow" class="properties-section music-analysis-section">
    <div class="music-analysis-heading">
      <div class="music-analysis-heading__title">
        <component :is="IconComponents.MUSIC" size="16px" />
        <h3 class="section-title">{{ t('properties.mediaItem.musicAnalysis.title') }}</h3>
      </div>
    </div>

    <template v-if="isAnalysisActive">
      <div class="music-analysis-progress">
        <div class="music-analysis-progress__status">
          <component
            :is="IconComponents.LOADING"
            size="16px"
            class="music-analysis-progress__icon"
          />
          <span>{{ analysisStatusText }}</span>
          <span v-if="progressPercent !== null" class="music-analysis-progress__percent">
            {{ progressPercent }}%
          </span>
        </div>
        <div class="music-analysis-progress__track" aria-hidden="true">
          <div
            class="music-analysis-progress__fill"
            :style="{ width: `${progressPercent ?? 0}%` }"
          />
        </div>
        <p v-if="musicAnalysisTask?.message" class="music-analysis-progress__detail">
          {{ musicAnalysisTask.message }}
        </p>
        <n-button size="small" secondary type="error" @click="handleCancelAnalysis">
          <template #icon>
            <component :is="IconComponents.CLOSE" size="16px" />
          </template>
          {{ t('properties.mediaItem.musicAnalysis.cancel') }}
        </n-button>
      </div>
    </template>

    <template v-else-if="analysis">
      <div
        class="music-analysis-metrics"
        :aria-label="t('properties.mediaItem.musicAnalysis.summary')"
      >
        <div class="music-analysis-metric">
          <span class="music-analysis-metric__label">{{
            t('properties.mediaItem.musicAnalysis.bpm')
          }}</span>
          <strong class="music-analysis-metric__value">
            {{ analysis.bpm ?? t('properties.mediaItem.musicAnalysis.unknownValue') }}
          </strong>
        </div>
        <div class="music-analysis-metric">
          <span class="music-analysis-metric__label">{{
            t('properties.mediaItem.musicAnalysis.meter')
          }}</span>
          <strong class="music-analysis-metric__value">{{ analysis.meter }}/4</strong>
        </div>
        <div class="music-analysis-metric">
          <span class="music-analysis-metric__label">
            {{ t('properties.mediaItem.musicAnalysis.segmentCount') }}
          </span>
          <strong class="music-analysis-metric__value">{{ displaySegments.length }}</strong>
        </div>
      </div>

      <div v-if="displaySegments.length > 0" class="music-analysis-structure">
        <div class="music-analysis-segment-list">
          <div
            v-for="segment in displaySegments"
            :key="`row-${segment.start}-${segment.end}-${segment.label}`"
            class="music-analysis-segment-row"
          >
            <span
              class="music-analysis-segment-row__swatch"
              :class="segmentColorClass(segment.label)"
              aria-hidden="true"
            />
            <span class="music-analysis-segment-row__time">
              {{ formatMusicTime(segment.start) }} - {{ formatMusicTime(segment.end) }}
            </span>
            <span class="music-analysis-segment-row__label">
              {{ formatSegmentLabel(segment.label) }}
            </span>
          </div>
        </div>
      </div>

      <div v-else class="music-analysis-empty-segments">
        {{ t('properties.mediaItem.musicAnalysis.emptySegments') }}
      </div>

      <details
        v-if="displayAnchors.length > 0"
        class="music-analysis-anchors"
        :open="anchorsExpanded"
        @toggle="handleAnchorToggle"
      >
        <summary class="music-analysis-anchors__summary">
          <span class="music-analysis-anchors__title">
            {{ t('properties.mediaItem.musicAnalysis.anchors.title') }}
          </span>
          <span class="music-analysis-anchors__count">
            {{
              t('properties.mediaItem.musicAnalysis.anchors.count', {
                count: displayAnchors.length,
              })
            }}
          </span>
          <component
            :is="IconComponents.DROPDOWN"
            size="14px"
            class="music-analysis-anchors__chevron"
            aria-hidden="true"
          />
        </summary>
        <div class="music-analysis-anchor-list" role="list">
          <div
            v-for="anchor in displayAnchors"
            :key="anchor.id"
            class="music-analysis-anchor-row"
            role="listitem"
          >
            <time class="music-analysis-anchor-row__time" :datetime="`${anchor.time}s`">
              {{ formatAnchorTime(anchor.time) }}
            </time>
            <div class="music-analysis-anchor-row__content">
              <span class="music-analysis-anchor-row__event">
                {{ formatAnchorEventLabel(anchor.eventLabel) }}
              </span>
              <span v-if="anchor.roles.length" class="music-analysis-anchor-row__roles">
                {{ formatAnchorRoles(anchor.roles) }}
              </span>
            </div>
            <span
              class="music-analysis-anchor-row__strength"
              :aria-label="anchorStrengthLabel(anchor.strength)"
              :title="anchorStrengthLabel(anchor.strength)"
            >
              <span
                v-for="bar in 3"
                :key="bar"
                class="music-analysis-anchor-row__strength-bar"
                :class="{
                  'music-analysis-anchor-row__strength-bar--active':
                    bar <= anchorStrengthBars(anchor.strength),
                }"
                aria-hidden="true"
              />
            </span>
          </div>
        </div>
      </details>
    </template>

    <div v-else class="music-analysis-not-started">
      <div>
        <span class="music-analysis-not-started__status">
          {{ t('properties.mediaItem.musicAnalysis.notAnalyzed') }}
        </span>
        <span class="music-analysis-not-started__range">
          {{ t('properties.mediaItem.musicAnalysis.durationRange') }}
        </span>
      </div>
      <n-button size="small" type="primary" @click="handleStartAnalysis(false)">
        <template #icon>
          <component :is="IconComponents.MUSIC" size="16px" />
        </template>
        {{ t('properties.mediaItem.musicAnalysis.analyze') }}
      </n-button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton } from 'naive-ui'
import { IconComponents } from '@/constants/iconComponents'
import { useAppI18n } from '@/core/composables/useI18n'
import { useMusicStructureAnalysis } from '@/core/composables/useMusicStructureAnalysis'
import { useUnifiedStore } from '@/core/unifiedStore'
import { MUSIC_STRUCTURE_ANALYSIS_RESOURCE_TYPE, type TaskView } from '@/core/jobs'
import type { MusicAnalysisMetadata, UnifiedMediaItemData } from '@/core/mediaitem/types'
import {
  getMusicAnalysisSegmentColorKey,
  MUSIC_ANALYSIS_MAX_DURATION_SECONDS,
  MUSIC_ANALYSIS_MIN_DURATION_SECONDS,
  type MusicAnalysisAnchor,
} from '@/core/utils/music-analysis'

interface Props {
  mediaItem: UnifiedMediaItemData
}

const props = defineProps<Props>()
const unifiedStore = useUnifiedStore()
const { t } = useAppI18n()
const { analyzeMusicStructure } = useMusicStructureAnalysis()

const analysis = computed<MusicAnalysisMetadata | undefined>(
  () => props.mediaItem.metadata?.musicAnalysis,
)
const anchorsExpanded = ref(false)
const hasAnalysis = computed(() => Boolean(analysis.value))
const musicAnalysisTask = computed<TaskView | undefined>(() =>
  unifiedStore.jobTaskViews.find(
    (task) =>
      task.rootResourceId === `${MUSIC_STRUCTURE_ANALYSIS_RESOURCE_TYPE}:${props.mediaItem.id}`,
  ),
)
const isAnalysisActive = computed(() => {
  const status = musicAnalysisTask.value?.status
  return status === 'idle' || status === 'queued' || status === 'running'
})
const isEligible = computed(() => {
  const bunnyMedia = props.mediaItem.runtime.bunny?.bunnyMedia
  const duration = bunnyMedia?.duration

  return (
    props.mediaItem.mediaStatus === 'ready' &&
    (props.mediaItem.mediaType === 'audio' || props.mediaItem.mediaType === 'video') &&
    typeof duration === 'number' &&
    Number.isFinite(duration) &&
    duration >= MUSIC_ANALYSIS_MIN_DURATION_SECONDS &&
    duration <= MUSIC_ANALYSIS_MAX_DURATION_SECONDS &&
    Boolean(bunnyMedia?.getAudioTrackInfo())
  )
})
const canStartAnalysis = computed(() => isEligible.value && !isAnalysisActive.value)
const shouldShow = computed(() => hasAnalysis.value || isAnalysisActive.value || isEligible.value)
const displaySegments = computed(() =>
  (analysis.value?.segments ?? []).filter(
    (segment) =>
      Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start,
  ),
)
const displayAnchors = computed<MusicAnalysisAnchor[]>(() =>
  (analysis.value?.editingAnchors ?? [])
    .filter(
      (anchor) =>
        typeof anchor.id === 'string' &&
        Number.isFinite(anchor.time) &&
        anchor.time >= 0 &&
        typeof anchor.eventLabel === 'string' &&
        Array.isArray(anchor.roles) &&
        Number.isFinite(anchor.strength),
    )
    .slice()
    .sort((left, right) => left.time - right.time || left.id.localeCompare(right.id)),
)

watch(
  () => props.mediaItem.id,
  () => {
    anchorsExpanded.value = false
  },
)
const progressPercent = computed<number | null>(() => {
  const progress = musicAnalysisTask.value?.progress
  if (typeof progress !== 'number' || !Number.isFinite(progress)) return null
  return Math.round(Math.min(1, Math.max(0, progress)) * 100)
})
const analysisStatusText = computed(() => {
  switch (musicAnalysisTask.value?.status) {
    case 'idle':
      return t('properties.mediaItem.musicAnalysis.preparing')
    case 'queued':
      return t('properties.mediaItem.musicAnalysis.queued')
    default:
      return t('properties.mediaItem.musicAnalysis.analyzing')
  }
})

function formatMusicTime(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const remainingSeconds = totalSeconds % 60
  const minuteSecond = `${minutes.toString().padStart(2, '0')}:${remainingSeconds
    .toString()
    .padStart(2, '0')}`

  return hours > 0 ? `${hours.toString().padStart(2, '0')}:${minuteSecond}` : minuteSecond
}

function formatAnchorTime(seconds: number): string {
  const totalCentiseconds = Math.max(0, Math.round(seconds * 100))
  const hours = Math.floor(totalCentiseconds / 360_000)
  const minutes = Math.floor((totalCentiseconds % 360_000) / 6_000)
  const remainingCentiseconds = totalCentiseconds % 6_000
  const wholeSeconds = Math.floor(remainingCentiseconds / 100)
  const centiseconds = remainingCentiseconds % 100
  const minuteSecond = `${minutes.toString().padStart(2, '0')}:${wholeSeconds
    .toString()
    .padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`

  return hours > 0 ? `${hours.toString().padStart(2, '0')}:${minuteSecond}` : minuteSecond
}

function formatSegmentLabel(label: string): string {
  const key = MUSIC_ANALYSIS_SEGMENT_LABEL_KEYS[label]
  return key ? t(`properties.mediaItem.musicAnalysis.segmentLabels.${key}`) : label
}

function segmentColorClass(label: string): string {
  return `music-analysis-segment--${getMusicAnalysisSegmentColorKey(label)}`
}

function formatAnchorEventLabel(label: string): string {
  const key = MUSIC_ANALYSIS_ANCHOR_EVENT_LABEL_KEYS[label]
  return key ? t(`properties.mediaItem.musicAnalysis.anchors.eventLabels.${key}`) : label
}

function formatAnchorRoles(roles: string[]): string {
  return roles
    .map((role) => {
      const key = MUSIC_ANALYSIS_ANCHOR_ROLE_LABEL_KEYS[role]
      return key ? t(`properties.mediaItem.musicAnalysis.anchors.roleLabels.${key}`) : role
    })
    .join(' · ')
}

function anchorStrengthBars(strength: number): number {
  if (strength >= 0.72) return 3
  if (strength >= 0.4) return 2
  return 1
}

function anchorStrengthLabel(strength: number): string {
  const level = anchorStrengthBars(strength)
  const key = level === 3 ? 'high' : level === 2 ? 'medium' : 'low'
  return t(`properties.mediaItem.musicAnalysis.anchors.strength.${key}`)
}

function handleAnchorToggle(event: Event): void {
  anchorsExpanded.value = (event.currentTarget as HTMLDetailsElement).open
}

async function handleStartAnalysis(force: boolean): Promise<void> {
  if (!canStartAnalysis.value) return
  await analyzeMusicStructure(props.mediaItem.id, force)
}

async function handleCancelAnalysis(): Promise<void> {
  const mediaItem = props.mediaItem
  const cancelled = await unifiedStore.cancelMusicStructureAnalysis(mediaItem.id)
  if (cancelled) {
    unifiedStore.messageSuccess(t('media.musicAnalysisCancelSuccess', { name: mediaItem.name }))
  } else {
    unifiedStore.messageWarning(t('media.musicAnalysisCancelFailed', { name: mediaItem.name }))
  }
}

const MUSIC_ANALYSIS_SEGMENT_LABEL_KEYS: Record<string, string> = {
  start: 'start',
  end: 'end',
  intro: 'intro',
  outro: 'outro',
  break: 'break',
  bridge: 'bridge',
  inst: 'instrumental',
  solo: 'solo',
  verse: 'verse',
  chorus: 'chorus',
}

const MUSIC_ANALYSIS_ANCHOR_EVENT_LABEL_KEYS: Record<string, string> = {
  anchor: 'anchor',
  section_entry: 'sectionEntry',
  section_exit: 'sectionExit',
  downbeat: 'downbeat',
  beat: 'beat',
  energy_rise: 'energyRise',
  energy_fall: 'energyFall',
  energy_peak: 'energyPeak',
  onset_event: 'onsetEvent',
  onset_entry: 'onsetEntry',
  onset_exit: 'onsetExit',
  silence_enter: 'silenceEnter',
  silence_exit: 'silenceExit',
  pitch_rise: 'pitchRise',
  pitch_fall: 'pitchFall',
  pitch_entry: 'pitchEntry',
  pitch_exit: 'pitchExit',
}

const MUSIC_ANALYSIS_ANCHOR_ROLE_LABEL_KEYS: Record<string, string> = {
  section_entry: 'sectionEntry',
  section_exit: 'sectionExit',
  build_up: 'buildUp',
  impact: 'impact',
  instrument_change: 'instrumentChange',
  pause: 'pause',
  release: 'release',
  melodic_turn: 'melodicTurn',
  rhythm_scaffold: 'rhythmScaffold',
}
</script>

<style scoped>
.music-analysis-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.music-analysis-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 40px;
}

.music-analysis-heading__title {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  color: var(--color-text-secondary);
}

.music-analysis-heading .section-title {
  margin-bottom: 0;
}

.music-analysis-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  padding: var(--spacing-sm) 0;
  border-top: 1px solid color-mix(in srgb, var(--color-border-default) 68%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--color-border-default) 68%, transparent);
}

.music-analysis-metric {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  padding: 0 var(--spacing-sm);
}

.music-analysis-metric + .music-analysis-metric {
  border-left: 1px solid color-mix(in srgb, var(--color-border-default) 68%, transparent);
}

.music-analysis-metric:first-child {
  padding-left: 0;
}

.music-analysis-metric__label,
.music-analysis-progress__detail,
.music-analysis-not-started__range {
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.music-analysis-metric__value {
  overflow: hidden;
  color: var(--color-text-primary);
  font-size: var(--font-size-md);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.music-analysis-structure {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.music-analysis-segment--start {
  background: #e2b93b;
}

.music-analysis-segment--intro {
  background: #2d7ff9;
}

.music-analysis-segment--verse {
  background: #20a464;
}

.music-analysis-segment--chorus {
  background: #e65b3d;
}

.music-analysis-segment--bridge {
  background: #8b5cf6;
}

.music-analysis-segment--break {
  background: #19a7a3;
}

.music-analysis-segment--instrumental {
  background: #d99822;
}

.music-analysis-segment--solo {
  background: #c844b7;
}

.music-analysis-segment--outro {
  background: #a94e6d;
}

.music-analysis-segment--end {
  background: #4b5563;
}

.music-analysis-segment--other {
  background: #78838f;
}

.music-analysis-segment-list {
  display: flex;
  flex-direction: column;
}

.music-analysis-segment-row {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) minmax(72px, auto);
  align-items: center;
  gap: var(--spacing-sm);
  min-height: 28px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-border-default) 58%, transparent);
  font-size: var(--font-size-sm);
}

.music-analysis-segment-row:last-child {
  border-bottom: none;
}

.music-analysis-segment-row__swatch {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.music-analysis-segment-row__time {
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  font-variant-numeric: tabular-nums;
}

.music-analysis-segment-row__label {
  overflow: hidden;
  color: var(--color-text-primary);
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.music-analysis-progress {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm);
  border-radius: var(--border-radius-small);
  background: color-mix(in srgb, var(--color-bg-quaternary) 84%, transparent);
}

.music-analysis-progress__status {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: 500;
}

.music-analysis-progress__icon {
  color: var(--color-status-processing);
  animation: music-analysis-spin 1s linear infinite;
}

.music-analysis-progress__percent {
  margin-left: auto;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  font-variant-numeric: tabular-nums;
}

.music-analysis-progress__track {
  height: 4px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--color-progress-background);
}

.music-analysis-progress__fill {
  height: 100%;
  border-radius: inherit;
  background: var(--color-status-processing);
  transition: width 180ms ease;
}

.music-analysis-progress__detail {
  margin: 0;
  line-height: 1.45;
  text-wrap: pretty;
}

.music-analysis-empty-segments {
  padding: var(--spacing-sm);
  border-radius: var(--border-radius-small);
  background: var(--color-bg-quaternary);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.music-analysis-anchors {
  border-top: 1px solid color-mix(in srgb, var(--color-border-default) 58%, transparent);
}

.music-analysis-anchors__summary {
  display: flex;
  align-items: center;
  min-height: 40px;
  cursor: pointer;
  list-style: none;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: 500;
  user-select: none;
}

.music-analysis-anchors__summary::-webkit-details-marker {
  display: none;
}

.music-analysis-anchors__title {
  min-width: 0;
  text-wrap: balance;
}

.music-analysis-anchors__count {
  margin-left: auto;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  font-variant-numeric: tabular-nums;
  font-weight: 400;
}

.music-analysis-anchors__chevron {
  margin-left: var(--spacing-xs);
  color: var(--color-text-secondary);
  transition: transform 160ms cubic-bezier(0.2, 0, 0, 1);
}

.music-analysis-anchors[open] .music-analysis-anchors__chevron {
  transform: rotate(180deg);
}

.music-analysis-anchor-list {
  display: flex;
  max-height: 248px;
  overflow-y: auto;
  flex-direction: column;
  border-top: 1px solid color-mix(in srgb, var(--color-border-default) 46%, transparent);
}

.music-analysis-anchor-row {
  display: grid;
  grid-template-columns: minmax(72px, auto) minmax(0, 1fr) 22px;
  align-items: center;
  min-height: 36px;
  gap: var(--spacing-sm);
  border-bottom: 1px solid color-mix(in srgb, var(--color-border-default) 46%, transparent);
}

.music-analysis-anchor-row:last-child {
  border-bottom: none;
}

.music-analysis-anchor-row__time {
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  font-variant-numeric: tabular-nums;
}

.music-analysis-anchor-row__content {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

.music-analysis-anchor-row__event,
.music-analysis-anchor-row__roles {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.music-analysis-anchor-row__event {
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
}

.music-analysis-anchor-row__roles {
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.music-analysis-anchor-row__strength {
  display: flex;
  height: 14px;
  align-items: end;
  justify-content: end;
  gap: 2px;
}

.music-analysis-anchor-row__strength-bar {
  width: 3px;
  border-radius: 1px;
  background: color-mix(in srgb, var(--color-text-secondary) 28%, transparent);
}

.music-analysis-anchor-row__strength-bar:nth-child(1) {
  height: 4px;
}

.music-analysis-anchor-row__strength-bar:nth-child(2) {
  height: 7px;
}

.music-analysis-anchor-row__strength-bar:nth-child(3) {
  height: 10px;
}

.music-analysis-anchor-row__strength-bar--active {
  background: var(--color-status-processing);
}

.music-analysis-not-started {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm);
  border-radius: var(--border-radius-small);
  background: color-mix(in srgb, var(--color-bg-quaternary) 84%, transparent);
}

.music-analysis-not-started > div {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}

.music-analysis-not-started__status {
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: 500;
}

@keyframes music-analysis-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}
</style>
