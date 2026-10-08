import Router from '@koa/router'
import * as ctrl from '../controllers/memory'

export const memoryRoutes = new Router()

memoryRoutes.get('/api/hermes/memory', ctrl.get)
memoryRoutes.post('/api/hermes/memory', ctrl.save)
memoryRoutes.get('/api/hermes/memory/projects', ctrl.listProjects)
memoryRoutes.post('/api/hermes/memory/projects', ctrl.saveProject)
