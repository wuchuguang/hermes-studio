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
