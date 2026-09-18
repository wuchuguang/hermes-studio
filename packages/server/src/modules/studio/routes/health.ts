import Router from '@koa/router'
import { readFile } from 'fs/promises'
import { join, resolve } from 'path'
import * as ctrl from '../controllers/health'

export const healthRoutes = new Router()

healthRoutes.get('/livez', ctrl.livenessCheck)
healthRoutes.get('/health', ctrl.healthCheck)

// Client shell build id: the first hashed asset referenced by index.html.
// PWA clients poll this and prompt for a reload when it changes — the SW
// caches hashed assets cache-first, so a stale shell would otherwise keep
// running an old bundle until a manual kill/reopen.
let buildIdCache: { at: number; id: string } | null = null
healthRoutes.get('/client-build-id', async (ctx) => {
  try {
    const now = Date.now()
    if (!buildIdCache || now - buildIdCache.at > 5000) {
      // Bundled server runs from dist/server (same __dirname as http.ts,
      // whose SPA fallback serves resolve(__dirname, '..', 'client')).
      const distDir = resolve(__dirname, '..', 'client')
      const html = await readFile(join(distDir, 'index.html'), 'utf8')
      const m = html.match(/assets\/js\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]+\.js/)
      buildIdCache = { at: now, id: m ? m[0] : 'unknown' }
    }
    ctx.set('Cache-Control', 'no-cache')
    ctx.body = { buildId: buildIdCache.id }
  } catch {
    ctx.body = { buildId: 'unknown' }
  }
})
