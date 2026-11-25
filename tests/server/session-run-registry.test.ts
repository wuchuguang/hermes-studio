import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acknowledgeSessionRunCancel,
  cancelAimsAtCurrentRun,
  clearSessionRun,
  heartbeatSessionRun,
  markSessionRunStarted,
  readSessionRunRegistry,
  requestSessionRunCancel,
} from '../../packages/server/src/modules/studio/services/session-run-registry'

let dir: string

vi.mock('../../packages/server/src/modules/hermes/services/runtime/path', () => ({ detectHermesRootHome: () => dir }))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'run-registry-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('session run registry cooperative cancel', () => {
  it('a fresh run must not inherit a cancel request aimed at the previous run', () => {
    markSessionRunStarted('s1', 'run-1', 'desktop')
    requestSessionRunCancel('s1')
    // The previous run ended and a NEW run starts for the same session: a fresh identity.
    markSessionRunStarted('s1', 'run-2', 'desktop')
    const entry = readSessionRunRegistry().s1
    expect(entry.cancel_requested_at).toBeUndefined()
    expect(entry.cancel_run_id).toBeUndefined()
    expect(entry.run_id).toBe('run-2')
  })

  it('a cancel stamped on a live run targets that exact run', () => {
    markSessionRunStarted('s2', 'run-1', 'studio')
    requestSessionRunCancel('s2')
    const entry = readSessionRunRegistry().s2
    expect(entry.cancel_requested_at).toBeDefined()
    expect(entry.cancel_run_id).toBe('run-1')
    expect(cancelAimsAtCurrentRun(entry)).toBe(true)
    // Steady-state heartbeats keep the pending cancel alive without changing identity.
    heartbeatSessionRun('s2', 'studio')
    expect(cancelAimsAtCurrentRun(readSessionRunRegistry().s2)).toBe(true)
  })

  it('cancel targeting skips requests aimed at a previous run', () => {
    markSessionRunStarted('s3', 'run-1', 'desktop')
    requestSessionRunCancel('s3')
    // Run boundary in the race window: new identity, stale cancel still on the entry?
    // markSessionRunStarted always publishes fresh, so target only mismatches on entries
    // written by older builds — model that by stamping the mismatch directly.
    markSessionRunStarted('s3', 'run-2', 'desktop')
    const entry = readSessionRunRegistry().s3
    entry.cancel_requested_at = Date.now()
    entry.cancel_run_id = 'run-1'
    expect(cancelAimsAtCurrentRun(entry)).toBe(false)
    // Legacy entries without cancel_run_id (older web build) are honored as-is.
    const legacy = { ...entry, cancel_run_id: undefined }
    expect(cancelAimsAtCurrentRun(legacy)).toBe(true)
  })

  it('acknowledging stamps cancel_acknowledged_at without dropping the entry', () => {
    markSessionRunStarted('s4', 'run-1', 'desktop')
    const stamped = requestSessionRunCancel('s4')
    expect(stamped?.cancel_requested_at).toBeDefined()
    acknowledgeSessionRunCancel('s4')
    const entry = readSessionRunRegistry().s4
    expect(entry.cancel_acknowledged_at).toBeDefined()
    expect(entry.origin).toBe('desktop')
  })

  it('clearing removes only the owning origin entry', () => {
    markSessionRunStarted('s5', 'run-1', 'studio')
    clearSessionRun('s5', 'desktop')
    expect(readSessionRunRegistry().s5).toBeDefined()
    clearSessionRun('s5', 'studio')
    expect(readSessionRunRegistry().s5).toBeUndefined()
  })

  it('the registry round-trips through the shared file for foreign readers', () => {
    markSessionRunStarted('s6', 'run-9', 'studio')
    const raw = JSON.parse(readFileSync(join(dir, 'state', 'session-runs.json'), 'utf8'))
    expect(raw.s6.origin).toBe('studio')
    expect(raw.s6.pid).toBe(process.pid)
    expect(typeof raw.s6.started_at).toBe('number')
  })
})
