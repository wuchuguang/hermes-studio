import { join } from 'path'
import { existsSync } from 'fs'
import { getActiveProfileDir } from '../../../hermes/services/profiles/profile'

/**
 * Read-only access to the Hermes Agent first-class Project store
 * (`projects.db`, written by `hermes project ...` / the desktop app).
 *
 * A Project is a human-named multi-folder workspace: one primary repo plus
 * any number of member directories (independent libs, sibling checkouts).
 * Studio only ever READS this store — creation/edition stays in Hermes
 * (`hermes project create ...`) so the two tools can't drift on writes.
 */

export interface StudioProjectFolder {
  path: string
  label: string | null
  is_primary: number
}

export interface StudioProject {
  id: string
  slug: string
  name: string
  description: string | null
  primary_path: string | null
  folders: StudioProjectFolder[]
}

function projectsDbPath(): string {
  return join(getActiveProfileDir(), 'projects.db')
}

function sqliteAvailable(): boolean {
  const [major, minor] = process.versions.node.split('.').map(Number)
  return major > 22 || (major === 22 && minor >= 5)
}

export async function listStudioProjects(): Promise<StudioProject[]> {
  const dbPath = projectsDbPath()
  if (!existsSync(dbPath)) return []
  if (!sqliteAvailable()) return []
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(dbPath, { open: true, readOnly: true })
  try {
    const projects = db
      .prepare(
        `SELECT id, slug, name, description, primary_path
         FROM projects WHERE archived = 0 ORDER BY created_at ASC`,
      )
      .all() as Array<Record<string, unknown>>
    const folderRows = db
      .prepare(`SELECT project_id, path, label, is_primary FROM project_folders`)
      .all() as Array<Record<string, unknown>>

    const byProject = new Map<string, StudioProjectFolder[]>()
    for (const row of folderRows) {
      const list = byProject.get(String(row.project_id)) || []
      list.push({
        path: String(row.path),
        label: row.label == null ? null : String(row.label),
        is_primary: Number(row.is_primary) ? 1 : 0,
      })
      byProject.set(String(row.project_id), list)
    }

    return projects.map((p) => {
      const folders = byProject.get(String(p.id)) || []
      // Primary first, then alphabetical — deterministic for the UI dropdown.
      folders.sort(
        (a, b) => b.is_primary - a.is_primary || a.path.localeCompare(b.path),
      )
      return {
        id: String(p.id),
        slug: String(p.slug),
        name: String(p.name),
        description: p.description == null ? null : String(p.description),
        primary_path: p.primary_path == null ? null : String(p.primary_path),
        folders,
      }
    })
  } finally {
    db.close()
  }
}
