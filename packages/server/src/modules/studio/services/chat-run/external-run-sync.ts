/**
 * External-run sync — keeps session "running" state consistent across the
 * studio server and the desktop app, which run sessions in separate processes.
 *
 * Every tick:
 *   1. heartbeat a registry entry for each session this server is running
 *   2. clear studio entries whose local run has ended (also cleans crash leftovers)
 *   3. honor cancel requests on own runs (cooperative cross-client cancel)
 *   4. periodically scan the shared state.dbs for sessions growing without us
 *      (heuristic: a desktop/gateway run is appending messages right now)
 *   5. broadcast transitions to every connected client
 *
 * The desktop runtime joins the same registry file (~/.hermes/state/session-runs.json);
 * until its side lands, desktop runs are detected via the growth heuristic only,
 * and a web cancel is delivered as a registry cancel request.
 */
import { randomUUID } from 'crypto'
import { logger } from '../../public/logging'
import {
  acknowledgeSessionRunCancel,
  cancelAimsAtCurrentRun,
  clearSessionRun,
  freshSessionRunEntries,
  heartbeatSessionRun,
  markSessionRunStarted,
  type SessionRunEntry,
} from '../session-run-registry'
import { listActiveSessionIdsSince } from '../../../hermes/services/history/sessions-db'

const TICK_MS = 2500
const ENTRY_FRESH_MS = 15000
const ACTIVITY_WINDOW_SECONDS = 45
const HEURISTIC_EVERY_TICKS = 4

interface ExternalRunSyncDeps {
  nsp: { emit: (event: string, payload: unknown) => void }
  getSessionMap: () => Map<string, unknown>
  isSessionRunning: (sessionId: string) => boolean
  abortSession: (sessionId: string, reason: string) => Promise<void>
}

let syncTimer: ReturnType<typeof setInterval> | null = null
let lastRunningIds = new Set<string>()
let lastWorkingIds = new Set<string>()
let heuristicActiveIds = new Set<string>()

/** Sessions running outside this server (foreign registry entries + activity heuristic). */
export function getExternallyRunningSessionIds(): Set<string> {
  const ids = new Set<string>()
  for (const [sessionId, entry] of Object.entries(freshSessionRunEntries(ENTRY_FRESH_MS))) {
    if (entry.origin !== 'studio') ids.add(sessionId)
  }
  for (const sessionId of heuristicActiveIds) ids.add(sessionId)
  return ids
}

export function startExternalRunSync(deps: ExternalRunSyncDeps): void {
  if (syncTimer) return
  let tick = 0
  syncTimer = setInterval(() => {
    tick += 1
    void runTick(deps, tick).catch((err) => logger.warn(err, '[external-run-sync] tick failed'))
  }, TICK_MS)
  syncTimer.unref?.()
}

export function stopExternalRunSync(): void {
  if (syncTimer) clearInterval(syncTimer)
  syncTimer = null
}

async function runTick(deps: ExternalRunSyncDeps, tick: number): Promise<void> {
  const sessionMap = deps.getSessionMap()

  // 1) Heartbeat own runs. A not-working → working transition is a NEW run: publish a
  // fresh identity so cancel targeting can never bleed across run boundaries.
  const workingNow = new Set<string>()
  for (const [sessionId, state] of sessionMap) {
    const working = !!(state as { isWorking?: boolean } | undefined)?.isWorking
    if (!working) continue
    workingNow.add(sessionId)
    if (!lastWorkingIds.has(sessionId)) {
      markSessionRunStarted(sessionId, randomUUID(), 'studio')
    } else if (freshSessionRunEntries(ENTRY_FRESH_MS)[sessionId]) {
      heartbeatSessionRun(sessionId)
    } else {
      markSessionRunStarted(sessionId, randomUUID(), 'studio')
    }
  }
  for (const sessionId of lastWorkingIds) {
    if (!workingNow.has(sessionId)) lastWorkingIds.delete(sessionId)
  }
  lastWorkingIds = workingNow

  const registry = freshSessionRunEntries(ENTRY_FRESH_MS * 6)

  // 2) Clear studio entries whose local run ended (covers crash leftovers too).
  for (const [sessionId, entry] of Object.entries(registry)) {
    if (entry.origin === 'studio' && !deps.isSessionRunning(sessionId)) clearSessionRun(sessionId, 'studio')
  }

  // 3) Honor cancel requests on own runs.
  for (const [sessionId, entry] of Object.entries(registry)) {
    if (entry.origin !== 'studio' || !entry.cancel_requested_at || entry.cancel_acknowledged_at) continue
    if (!deps.isSessionRunning(sessionId)) continue
    // Run-targeting guard: a cancel stamped against a PREVIOUS run must not kill this one.
    if (!cancelAimsAtCurrentRun(entry)) continue
    logger.info('[external-run-sync] honoring cancel request for session %s', sessionId)
    await deps.abortSession(sessionId, 'Cancelled from another client').catch(() => {})
    acknowledgeSessionRunCancel(sessionId)
  }

  // 4) Heuristic: sessions growing in state.db without this server running them.
  if (tick % HEURISTIC_EVERY_TICKS === 1) {
    try {
      const since = Math.floor(Date.now() / 1000) - ACTIVITY_WINDOW_SECONDS
      const ids = await listActiveSessionIdsSince(since)
      heuristicActiveIds = new Set(ids.filter((sessionId) => !deps.isSessionRunning(sessionId)))
    } catch (err) {
      logger.warn(err, '[external-run-sync] activity scan failed')
    }
  }

  // 5) Broadcast transitions.
  const running = getExternallyRunningSessionIds()
  const changes: Array<{ session_id: string; running: boolean }> = []
  for (const sessionId of running) {
    if (!lastRunningIds.has(sessionId)) changes.push({ session_id: sessionId, running: true })
  }
  for (const sessionId of lastRunningIds) {
    if (!running.has(sessionId)) changes.push({ session_id: sessionId, running: false })
  }
  lastRunningIds = running
  if (changes.length) {
    deps.nsp.emit('session.run.external', { changes, at: Date.now() })
  }
}

export type { SessionRunEntry }
