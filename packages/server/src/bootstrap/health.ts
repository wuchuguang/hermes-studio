import { getAgentBridgeManager } from '../modules/hermes/services/bridge/manager'
import { redactAgentBridgeError } from '../modules/hermes/services/bridge/redact'
import * as hermesCli from '../modules/hermes/services/runtime/cli'
import { isDockerContainer } from '../modules/studio/public/runtime-environment'
import type { AgentBridgeHealthPayload } from '../modules/studio/contracts/health'
import { StudioHealthService } from '../modules/studio/services/health'
import {
  checkLatestVersion,
  configureHealthController,
  healthCheck,
  livenessCheck,
  startVersionCheck,
} from '../modules/studio/controllers/health'
import { healthRoutes } from '../modules/studio/routes/health'

const AGENT_BRIDGE_HEALTH_CACHE_TTL_MS = 250
const AGENT_BRIDGE_HEALTH_FIRST_WAIT_MS = 75

let cachedAgentBridgeHealth: { value: AgentBridgeHealthPayload; expiresAt: number } | null = null
let pendingAgentBridgeHealthRefresh: Promise<AgentBridgeHealthPayload> | null = null

async function refreshAgentBridgeHealth(): Promise<AgentBridgeHealthPayload> {
  let endpoint: string | undefined
  try {
    const manager = getAgentBridgeManager()
    endpoint = typeof manager.getRuntimeState === 'function'
      ? manager.getRuntimeState().endpoint
      : undefined
    const readiness = await manager.checkReadiness({
      timeoutMs: AGENT_BRIDGE_HEALTH_FIRST_WAIT_MS,
      connectRetryMs: 0,
    })
    const value: AgentBridgeHealthPayload = {
      status: readiness.status,
      reachable: readiness.reachable,
      ready: readiness.ready,
      running: readiness.running,
      attached: readiness.attached,
      starting: readiness.starting,
      stopping: readiness.stopping,
      restart_scheduled: readiness.restartScheduled,
      restart_attempts: readiness.restartAttempts,
      endpoint_kind: readiness.endpointKind,
      pid: readiness.pid,
      error: redactAgentBridgeError(readiness.error, readiness.endpoint),
    }
    cachedAgentBridgeHealth = {
      value,
      expiresAt: Date.now() + AGENT_BRIDGE_HEALTH_CACHE_TTL_MS,
    }
    return value
  } catch (error) {
    const value: AgentBridgeHealthPayload = {
      status: 'unknown',
      reachable: false,
      error: redactAgentBridgeError(
        error instanceof Error ? error.message : String(error),
        endpoint,
      ),
    }
    cachedAgentBridgeHealth = {
      value,
      expiresAt: Date.now() + AGENT_BRIDGE_HEALTH_CACHE_TTL_MS,
    }
    return value
  }
}

async function getAgentBridgeHealth(): Promise<AgentBridgeHealthPayload> {
  const now = Date.now()
  if (cachedAgentBridgeHealth && cachedAgentBridgeHealth.expiresAt > now) {
    return cachedAgentBridgeHealth.value
  }

  if (!pendingAgentBridgeHealthRefresh) {
    pendingAgentBridgeHealthRefresh = refreshAgentBridgeHealth().finally(() => {
      pendingAgentBridgeHealthRefresh = null
    })
  }

  if (cachedAgentBridgeHealth) return cachedAgentBridgeHealth.value

  return Promise.race([
    pendingAgentBridgeHealthRefresh,
    new Promise<AgentBridgeHealthPayload>((resolve) => {
      setTimeout(
        () => resolve({ status: 'unknown', reachable: false }),
        AGENT_BRIDGE_HEALTH_FIRST_WAIT_MS,
      )
    }),
  ])
}

const healthService = new StudioHealthService({
  platform: 'hermes-agent',
  getPrimaryAgentVersion: () => hermesCli.getVersion(),
  getPrimaryAgentBridgeHealth: getAgentBridgeHealth,
  isDockerContainer,
})

configureHealthController(healthService)

/**
 * Anonymous, minimal payload for the web/PWA boot screen: is the local
 * desktop-side agent bridge (the Mac Hermes runtime) reachable right now.
 * Deliberately exposes a single boolean — no endpoints, pids or errors — so it
 * is safe to serve without auth; clients use it to show "Mac 端未运行"
 * instead of an infinite loading spinner.
 */
export async function getDesktopRuntimeHealth(): Promise<{ agent_bridge_reachable: boolean }> {
  const health = await getAgentBridgeHealth()
  return { agent_bridge_reachable: health.reachable === true }
}

export {
  checkLatestVersion,
  healthCheck,
  healthRoutes,
  livenessCheck,
  startVersionCheck,
}
