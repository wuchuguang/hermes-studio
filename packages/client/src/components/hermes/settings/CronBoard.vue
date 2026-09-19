<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NButton, NSpin, NTag } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { request } from '@/api/client'

/**
 * Read-only cron board: hermes cron jobs + their latest run outputs.
 * Job CRUD stays in the hermes CLI (single-writer, same as projects);
 * this view answers "what's scheduled / did it run OK / what did it produce".
 */
interface CronJob {
  id: string
  name: string
  schedule: string
  enabled: boolean
  state: string | null
  lastRunAt: string | null
  lastStatus: string | null
  lastError: string | null
  nextRunAt: string | null
  completed: number | null
  failureStreak: number
  skill: string | null
}

interface OutputFile {
  file: string
  size: number
  content: string
}

const { t } = useI18n()
const jobs = ref<CronJob[]>([])
const loading = ref(false)
const expandedId = ref<string | null>(null)
const outputs = ref<OutputFile[]>([])
const outputsLoading = ref(false)
const outputsTotal = ref(0)

async function load() {
  loading.value = true
  try {
    const res = await request<{ jobs?: CronJob[] }>('/api/studio/cron/jobs')
    jobs.value = (res?.jobs || []).slice().sort((a, b) => {
      // failing first, then enabled, then name
      const fail = (b.failureStreak || 0) - (a.failureStreak || 0)
      if (fail) return fail
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  } finally {
    loading.value = false
  }
}

async function toggle(id: string) {
  if (expandedId.value === id) {
    expandedId.value = null
    return
  }
  expandedId.value = id
  outputsLoading.value = true
  outputs.value = []
  try {
    const res = await request<{ outputs?: OutputFile[]; total?: number }>(
      `/api/studio/cron/jobs/${encodeURIComponent(id)}/outputs`,
    )
    outputs.value = res?.outputs || []
    outputsTotal.value = res?.total || 0
  } finally {
    outputsLoading.value = false
  }
}

function fmtWhen(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function fmtSize(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`
}

onMounted(load)
</script>

<template>
  <div class="cron-board">
    <div class="cron-board-header">
      <span class="cron-board-title">{{ t('settings.cron.title') }}</span>
      <NButton size="tiny" quaternary :loading="loading" @click="load">
        {{ t('settings.cron.refresh') }}
      </NButton>
    </div>
    <p class="cron-board-hint">{{ t('settings.cron.hint') }}</p>

    <div v-if="!loading && !jobs.length" class="cron-empty">{{ t('settings.cron.empty') }}</div>
    <div v-for="job in jobs" :key="job.id" class="cron-job" :class="{ failing: job.failureStreak > 0 }">
      <button class="cron-job-row" type="button" @click="toggle(job.id)">
        <span class="cron-job-name">
          <span class="cron-dot" :class="job.failureStreak > 0 ? 'bad' : job.enabled ? (job.lastStatus === 'ok' ? 'ok' : 'idle') : 'off'" />
          {{ job.name }}
        </span>
        <span class="cron-job-meta">
          <NTag size="small" :bordered="false" :type="job.enabled ? 'default' : 'warning'">
            {{ job.enabled ? job.schedule : t('settings.cron.disabled') }}
          </NTag>
          <span class="cron-job-when">{{ t('settings.cron.next') }} {{ fmtWhen(job.nextRunAt) }}</span>
          <span v-if="job.completed != null" class="cron-job-count">×{{ job.completed }}</span>
          <span class="cron-job-expand">{{ expandedId === job.id ? '▾' : '▸' }}</span>
        </span>
      </button>
      <div v-if="job.lastError" class="cron-job-error" :title="job.lastError">{{ job.lastError }}</div>
      <div v-if="expandedId === job.id" class="cron-job-outputs">
        <div class="cron-job-facts">
          <span>{{ t('settings.cron.last') }} {{ fmtWhen(job.lastRunAt) }} · {{ job.lastStatus || '—' }}</span>
          <span v-if="job.skill">{{ t('settings.cron.skill') }} {{ job.skill }}</span>
        </div>
        <NSpin v-if="outputsLoading" size="small" />
        <template v-else>
          <div v-if="!outputs.length" class="cron-empty">{{ t('settings.cron.noOutputs') }}</div>
          <details v-for="o in outputs" :key="o.file" class="cron-output">
            <summary>{{ o.file }} <span class="cron-output-size">{{ fmtSize(o.size) }}B</span></summary>
            <pre class="cron-output-pre">{{ o.content }}</pre>
          </details>
          <div v-if="outputsTotal > outputs.length" class="cron-more">
            {{ t('settings.cron.moreOutputs', { n: outputsTotal - outputs.length }) }}
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.cron-board {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cron-board-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.cron-board-title {
  font-weight: 600;
  font-size: 14px;
}

.cron-board-hint {
  font-size: 12px;
  opacity: 0.55;
  margin: 0;
}

.cron-empty {
  font-size: 12px;
  opacity: 0.5;
  padding: 8px 0;
}

.cron-job {
  border: 1px solid var(--border, rgba(128, 128, 128, 0.25));
  border-radius: 8px;
  padding: 6px 10px;

  &.failing {
    border-color: rgba(239, 68, 68, 0.5);
  }
}

.cron-job-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  border: none;
  background: none;
  color: inherit;
  cursor: pointer;
  padding: 4px 0;
  text-align: left;
  font-size: 13px;
}

.cron-job-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cron-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;

  &.ok { background: #22c55e; }
  &.idle { background: #f59e0b; }
  &.bad { background: #ef4444; }
  &.off { background: rgba(128, 128, 128, 0.4); }
}

.cron-job-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  font-size: 11px;
  opacity: 0.75;
}

.cron-job-when {
  font-variant-numeric: tabular-nums;
}

.cron-job-count {
  opacity: 0.6;
}

.cron-job-expand {
  opacity: 0.5;
}

.cron-job-error {
  font-size: 11px;
  color: #ef4444;
  padding: 2px 0 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cron-job-outputs {
  padding: 6px 0 4px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cron-job-facts {
  display: flex;
  gap: 14px;
  font-size: 11px;
  opacity: 0.6;
}

.cron-output {
  font-size: 12px;

  summary {
    cursor: pointer;
    opacity: 0.8;
  }
}

.cron-output-size {
  opacity: 0.5;
  margin-left: 6px;
}

.cron-output-pre {
  max-height: 240px;
  overflow: auto;
  background: rgba(128, 128, 128, 0.08);
  border-radius: 6px;
  padding: 8px;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11px;
}

.cron-more {
  font-size: 11px;
  opacity: 0.5;
}
</style>
