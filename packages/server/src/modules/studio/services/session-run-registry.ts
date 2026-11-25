/**
 * Shared cross-process session run registry.
 *
 * Web (studio) runs and desktop-app runs execute in different processes; the
 * only shared medium is the hermes home directory. This file-backed registry
 * lets each side publish "session X is running" heartbeats and request cancels
 * for runs owned by the other side:
 *   - origin 'studio' entries are written by this server's external-run sync
 *   - foreign entries ('desktop', …) are published by the desktop runtime
 * Entries carry a heartbeat; stale entries are ignored. `cancel_requested_at`
 * is honored by the owning side's own sync loop — cooperative cancel, nobody
 * kills another process's run.
 *
 * Concurrent writers (studio + desktop) do read-modify-write with tmp+rename;
 * a lost update at worst costs one heartbeat, which the next tick restores.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { detectHermesRootHome } from '../../hermes/services/runtime/path'

export type SessionRunOrigin = 'studio' | 'desktop' | 'cli' | 'other'

export interface SessionRunEntry {
  run_id?: string
  origin: SessionRunOrigin
  pid: number
  started_at: number
  heartbeat_at: number
  cancel_requested_at?: number
  /** Which run_id the cancel request was stamped against (run-targeting guard). */
  cancel_run_id?: string
  cancel_acknowledged_at?: number
  inferred?: boolean
}

export type SessionRunRegistry = Record<string, SessionRunEntry>

const WRITE_RETRIES = 3

function registryFile(): string {
  return join(detectHermesRootHome(), 'state', 'session-runs.json')
}

export function readSessionRunRegistry(): SessionRunRegistry {
  const file = registryFile()
  if (!existsSync(file)) return {}
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed as SessionRunRegistry : {}
  } catch {
    return {}
  }
}

function writeSessionRunRegistry(registry: SessionRunRegistry): void {
  const file = registryFile()
  mkdirSync(join(file, '..'), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(registry), 'utf8')
  renameSync(tmp, file)
}

/** Read-merge-write with retries; returns the mutator's result, or null on give-up. */
function mutateSessionRunRegistry<T>(mutator: (registry: SessionRunRegistry) => T): T | null {
  for (let attempt = 0; attempt < WRITE_RETRIES; attempt++) {
    const registry = readSessionRunRegistry()
    const result = mutator(registry)
    try {
      writeSessionRunRegistry(registry)
      return result
    } catch {
      // Rename can fail under a concurrent writer; retry with a fresh read.
    }
  }
  return null
}

export function markSessionRunStarted(sessionId: string, runId: string | undefined, origin: SessionRunOrigin = 'studio', inferred = false): void {
  const now = Date.now()
  mutateSessionRunRegistry((registry) => {
    // Always a FRESH entry: this is only called at run start (the sync loop detects the
    // not-working → working transition), so inheriting a previous run's cancel state here
    // would let a stale cancel request kill the new run.
    const entry: SessionRunEntry = {
      run_id: runId,
      origin,
      pid: process.pid,
      started_at: now,
      heartbeat_at: now,
    }
    if (inferred) entry.inferred = true
    registry[sessionId] = entry
  })
}

export function heartbeatSessionRun(sessionId: string, origin: SessionRunOrigin = 'studio'): void {
  const now = Date.now()
  mutateSessionRunRegistry((registry) => {
    const entry = registry[sessionId]
    if (!entry || (origin !== 'studio' && entry.origin !== origin)) return
    entry.heartbeat_at = now
    entry.pid = process.pid
  })
}

export function clearSessionRun(sessionId: string, origin?: SessionRunOrigin): void {
  mutateSessionRunRegistry((registry) => {
    const entry = registry[sessionId]
    if (!entry) return
    if (origin && entry.origin !== origin) return
    delete registry[sessionId]
  })
}

/** Stamp a cooperative cancel request on a fresh run entry; null when nothing is running.
 *  Records `cancel_run_id` so the owner can tell a cancel aimed at the CURRENT run from a
 *  stale one that survived on the entry past a run boundary (cooperative-cancel race). */
export function requestSessionRunCancel(sessionId: string, freshMs = 15000): SessionRunEntry | null {
  const now = Date.now()
  return mutateSessionRunRegistry((registry) => {
    const entry = registry[sessionId]
    if (!entry || now - entry.heartbeat_at > freshMs) return null
    if (!entry.cancel_requested_at) {
      entry.cancel_requested_at = now
      entry.cancel_run_id = entry.run_id
    }
    return { ...entry }
  })
}

/** True when a stamped cancel request targets the entry's CURRENT run. Entries without
 *  `cancel_run_id` predate run targeting (older web build) and are honored as-is. */
export function cancelAimsAtCurrentRun(entry: SessionRunEntry): boolean {
  if (!entry.cancel_requested_at) return false
  if (!entry.cancel_run_id || !entry.run_id) return true
  return entry.cancel_run_id === entry.run_id
}

export function acknowledgeSessionRunCancel(sessionId: string): void {
  const now = Date.now()
  mutateSessionRunRegistry((registry) => {
    const entry = registry[sessionId]
    if (!entry) return
    entry.cancel_acknowledged_at = now
  })
}

export function freshSessionRunEntries(freshMs = 15000): SessionRunRegistry {
  const now = Date.now()
  const result: SessionRunRegistry = {}
  for (const [sessionId, entry] of Object.entries(readSessionRunRegistry())) {
    if (entry && now - entry.heartbeat_at <= freshMs) result[sessionId] = entry
  }
  return result
}
