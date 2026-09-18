import { homedir } from 'os'
import { join } from 'path'
import { readdir } from 'fs/promises'

const MAX_SEARCH_DEPTH = 4
const MAX_RESULTS = 24
// Full-tree walk result cache: keystroke bursts re-query the same tree and
// home dirs are static on the scale of a picker session. Short TTL only —
// this is a responsiveness cache, not a consistency mechanism. (No
// mdfind/Spotlight here on purpose: the user's machine has it disabled.)
const CACHE_TTL_MS = 60_000
const CACHE_MAX_ENTRIES = 32
const PRUNED_DIR_NAMES = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'dist_electron',
  'target', 'venv', '.venv', '__pycache__', '.cache', 'coverage',
  '.gradle', 'Pods', 'DerivedData', '.hermes', 'Library', 'Applications',
])

interface DirHit {
  path: string
  name: string
}

interface CacheEntry {
  at: number
  hits: DirHit[]
}

const walkCache = new Map<string, CacheEntry>()

function sweepWalkCache(now: number) {
  for (const [key, entry] of walkCache) {
    if (now - entry.at > CACHE_TTL_MS) walkCache.delete(key)
  }
}

async function walkAllDirs(base: string): Promise<DirHit[]> {
  const hits: DirHit[] = []
  const now = Date.now()
  sweepWalkCache(now)
  const cached = walkCache.get(base)
  if (cached && now - cached.at <= CACHE_TTL_MS) return cached.hits

  async function walk(dir: string, depth: number): Promise<void> {
    if (hits.length >= MAX_RESULTS || depth > MAX_SEARCH_DEPTH) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (hits.length >= MAX_RESULTS) return
      if (!entry.isDirectory()) continue
      const name = entry.name
      if (PRUNED_DIR_NAMES.has(name)) continue
      if (name.startsWith('.')) continue
      const full = join(dir, name)
      hits.push({ path: full, name })
      if (hits.length >= MAX_RESULTS) return
      if (depth < MAX_SEARCH_DEPTH) await walk(full, depth + 1)
    }
  }

  await walk(base, 1)
  if (walkCache.size >= CACHE_MAX_ENTRIES) walkCache.clear()
  walkCache.set(base, { at: now, hits: [...hits] })
  return hits
}

/** CJK chars carry ~a full word each; one hanzi is a meaningful query. */
function hasCjk(s: string): boolean {
  return /[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/.test(s)
}

/**
 * GET /api/studio/projects/dir-search?q=...
 * Fuzzy find directories by name under the workspace base (default: home).
 * The tree is walked once per TTL window and filtered per query; CJK
 * queries match from one character.
 */
export async function searchWorkspaceDirs(query: string): Promise<DirHit[]> {
  const base = process.env.WORKSPACE_BASE?.trim() || homedir()
  const needle = query.trim().toLowerCase()
  if (!needle || (needle.length < 2 && !hasCjk(needle))) return []
  const all = await walkAllDirs(base)
  const startsWith: DirHit[] = []
  const includes: DirHit[] = []
  for (const hit of all) {
    const name = hit.name.toLowerCase()
    if (name.startsWith(needle)) startsWith.push(hit)
    else if (name.includes(needle)) includes.push(hit)
  }
  const hits = [...startsWith, ...includes]
  return hits
    .sort((a, b) =>
      a.name.length - b.name.length || a.path.localeCompare(b.path))
    .slice(0, MAX_RESULTS)
}
