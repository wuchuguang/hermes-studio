import Router from '@koa/router'
import { listStudioProjects } from '../services/projects/projects-db'

export const projectRoutes = new Router()

/**
 * GET /api/studio/projects — read-only list of Hermes first-class Projects
 * (multi-folder workspaces from projects.db, managed via `hermes project`).
 * The client uses this to bind a whole project (primary + member dirs) to a
 * session's workspace in one click.
 */
projectRoutes.get('/api/studio/projects', async (ctx) => {
  try {
    const projects = await listStudioProjects()
    ctx.body = { projects, ok: true }
  } catch (err: any) {
    console.error('[projects] list failed:', err?.message || err)
    ctx.body = { projects: [], ok: true, error: err?.message || 'list failed' }
  }
})

/**
 * GET /api/studio/projects/dir-search?q=... — fuzzy directory search under
 * the workspace base, for picking extra dirs by name instead of by hand.
 */
projectRoutes.get('/api/studio/projects/dir-search', async (ctx) => {
  const { searchWorkspaceDirs } = await import('../services/workspace/dir-search')
  const q = String(ctx.query.q || '')
  try {
    const dirs = await searchWorkspaceDirs(q)
    ctx.body = { dirs, ok: true }
  } catch (err: any) {
    ctx.body = { dirs: [], ok: true, error: err?.message || 'search failed' }
  }
})
