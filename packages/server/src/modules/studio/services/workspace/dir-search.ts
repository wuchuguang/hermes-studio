import { homedir } from 'os'
import { join } from 'path'
import { readdir } from 'fs/promises'

const MAX_SEARCH_DEPTH = 4
const MAX_RESULTS = 24
const PRUNED_DIR_NAMES = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'dist_electron',
  'target', 'venv', '.venv', '__pycache__', '.cache', 'coverage',
  '.gradle', 'Pods', 'DerivedData', '.hermes', 'Library', 'Applications',
])

interface DirHit {
  path: string
  name: string
}

/**
 * GET /api/studio/workspace/folders/search?q=...
 * Fuzzy find directories by name under the workspace base (default: home).
 * Bounded depth-first walk so it stays fast on big home dirs; junk dirs
 * (node_modules, .git, Library, ...) are pruned entirely.
 */
export async function searchWorkspaceDirs(query: string): Promise<DirHit[]> {
  const base = process.env.WORKSPACE_BASE?.trim() || homedir()
  const needle = query.trim().toLowerCase()
  if (!needle || needle.length < 2) return []
  const hits: DirHit[] = []

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
      if (name.startsWith('.') && needle !== name.toLowerCase() && !name.toLowerCase().includes(needle)) continue
      if (PRUNED_DIR_NAMES.has(name)) continue
      const full = join(dir, name)
      if (name.toLowerCase().includes(needle)) {
        hits.push({ path: full, name })
        if (hits.length >= MAX_RESULTS) return
        continue
      }
      if (depth < MAX_SEARCH_DEPTH) await walk(full, depth + 1)
    }
  }

  await walk(base, 1)
  hits.sort((a, b) => {
    const an = a.name.toLowerCase().startsWith(needle) ? 0 : 1
    const bn = b.name.toLowerCase().startsWith(needle) ? 0 : 1
    return an - bn || a.name.length - b.name.length || a.path.localeCompare(b.path)
  })
  return hits.slice(0, MAX_RESULTS)
}
