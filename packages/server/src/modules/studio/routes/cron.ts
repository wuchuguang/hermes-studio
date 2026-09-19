import Router from '@koa/router'
import { readFile, readdir } from 'fs/promises'
import { join } from 'path'

export const cronRoutes = new Router()

interface JobSummary {
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

interface JobsFile {
  jobs?: Array<Record<string, any>>
}

function cronDir(): string {
  return process.env.HERMES_HOME
    ? join(process.env.HERMES_HOME, 'cron')
    : join(process.env.HOME || '', '.hermes', 'cron')
}

// jobs.json is rewritten by the dispatcher; read-only here, short cache to
// absorb bursts when several clients poll.
let cache: { at: number; jobs: JobSummary[] } | null = null
const CACHE_MS = 5000

/**
 * GET /api/studio/cron/jobs — read-only view of the Hermes cron jobs
 * (jobs.json) plus the latest run artifact per job (cron/output/<id>/).
 * No write endpoints: job CRUD stays in hermes CLI (`hermes cron ...`),
 * same single-writer rule as projects.
 */
cronRoutes.get('/api/studio/cron/jobs', async (ctx) => {
  try {
    const now = Date.now()
    if (!cache || now - cache.at > CACHE_MS) {
      const raw = await readFile(join(cronDir(), 'jobs.json'), 'utf8')
      const parsed = JSON.parse(raw) as JobsFile
      const jobs = parsed.jobs || (Array.isArray(parsed) ? (parsed as any) : [])
      cache = {
        at: now,
        jobs: jobs.map((j: Record<string, any>): JobSummary => ({
          id: String(j.id || ''),
          name: String(j.name || j.id || ''),
          schedule: j.schedule_display || j.schedule?.display || j.schedule?.expr || '',
          enabled: Boolean(j.enabled),
          state: j.state || null,
          lastRunAt: j.last_run_at || null,
          lastStatus: j.last_status || null,
          lastError: j.last_error || null,
          nextRunAt: j.next_run_at || null,
          completed: j.repeat?.completed ?? null,
          failureStreak: Number(j.failure_streak || 0),
          skill: j.skill || (Array.isArray(j.skills) ? j.skills[0] : null) || null,
        })),
      }
    }
    ctx.set('Cache-Control', 'no-cache')
    ctx.body = { jobs: cache.jobs, ok: true }
  } catch (err: any) {
    ctx.status = 500
    ctx.body = { jobs: [], ok: false, error: err?.message || 'read failed' }
  }
})

/**
 * GET /api/studio/cron/jobs/:id/outputs — recent run outputs (markdown).
 * Returns the newest files first, capped so a 14-job board stays fast.
 */
cronRoutes.get('/api/studio/cron/jobs/:id/outputs', async (ctx) => {
  try {
    const dir = join(cronDir(), 'output', String(ctx.params.id))
    const files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort().reverse()
    const recent = files.slice(0, 10)
    const outputs = await Promise.all(recent.map(async (f) => {
      const full = join(dir, f)
      const content = await readFile(full, 'utf8')
      return { file: f, size: content.length, content: content.slice(0, 4000) }
    }))
    ctx.set('Cache-Control', 'no-cache')
    ctx.body = { outputs, total: files.length, ok: true }
  } catch {
    ctx.body = { outputs: [], total: 0, ok: true }
  }
})
