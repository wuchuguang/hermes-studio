import { randomUUID } from 'node:crypto'
import type { AuthenticatedUser } from '../../public/auth'
import { createSession, getSession } from '../../repositories/session-store'
import { userCanAccessProfile } from '../../repositories/users-store'
import { isPrivatePersonSession, ownsPersonSession } from '../../contracts/person-session'
import { isGlobalOnlyCodingAgent } from '../../contracts/agents/native-coding-agents'
import { resolveAgentStatusId } from '../agent-availability'
import { getChatRunServer } from '../../public/chat-run'
import { requestSessionRunCancel } from '../session-run-registry'
import { findHermesSessionProfile } from '../../public/session-agent-runtime'
import { businessEvents } from '../webhooks/business-events'
import { pluginAgentIsGlobalOnly } from '../agents/registry'

function failure(message: string, status: number): never { throw Object.assign(new Error(message), { status }) }
export function authorizeSessionProfile(user: AuthenticatedUser | undefined, profile: string): asserts user is AuthenticatedUser {
  if (!user) failure('Studio login required', 401)
  if (user.role !== 'super_admin' && !userCanAccessProfile(user.id, profile)) failure('Profile access denied', 403)
}
export function controlledSession(user: AuthenticatedUser | undefined, profile: string, id: string) {
  authorizeSessionProfile(user, profile)
  const session = getSession(id)
  if (!session || isPrivatePersonSession(id) && !ownsPersonSession(user.id, session)) failure('Session not found', 404)
  if ((session.profile || 'default') !== profile) failure('Session belongs to another Profile', 403)
  return session
}
export function prepareSessionRun(user: AuthenticatedUser | undefined, profile: string, input: Record<string, unknown>): Record<string, unknown> {
  if (typeof input.session_id !== 'string' || !getSession(input.session_id)) return input
  const session = controlledSession(user, profile, input.session_id)
  return { ...input, source: input.source ?? session.source,
    provider: input.provider ?? session.provider, model: input.model ?? session.model,
    apiMode: input.apiMode ?? input.api_mode ?? session.api_mode,
    ...(session.agent && session.agent !== 'hermes' ? { agent_id: input.agent_id ?? input.coding_agent_id ?? session.agent, mode: input.mode ?? session.agent_mode } : {}) }
}
export function createEmptySession(user: AuthenticatedUser | undefined, profile: string, input: Record<string, unknown>) {
  authorizeSessionProfile(user, profile)
  if (input.title !== undefined && (typeof input.title !== 'string' || input.title.length > 500)) failure('Invalid session title', 400)
  const agent = resolveAgentStatusId(input.agent ?? 'ekko-agent')
  if (!agent) failure('Invalid agent', 400)
  if (input.mode !== undefined && input.mode !== 'scoped' && input.mode !== 'global') failure('Invalid agent mode', 400)
  const session = createSession({ id: randomUUID(), profile, user_id: user.id, agent,
    source: agent === 'hermes' ? 'cli' : agent === 'ekko-agent' ? 'builtin_agent' : 'coding_agent',
    agent_mode: agent === 'hermes' ? '' : isGlobalOnlyCodingAgent(agent) || pluginAgentIsGlobalOnly(agent) ? 'global' : String(input.mode || 'scoped'), title: String(input.title || '') })
  businessEvents.publish({ schema_version: 1, id: randomUUID(), type: 'chat.session.created', occurred_at: new Date().toISOString(),
    profile, source: 'chat', subject: { session_id: session.id }, payload: { owner_user_id: user.id, session: { id: session.id, title: session.title, agent: session.agent } } })
  return { session }
}
export async function stopSession(user: AuthenticatedUser | undefined, profile: string, id: string) {
  // A desktop-owned session may exist ONLY in a state.db (no studio local row): the
  // cancel path must still reach the shared run registry for those, so fall back to
  // resolving the session's owning profile db instead of failing with 404.
  const session = getSession(id)
  if (session) {
    authorizeSessionProfile(user, profile)
    if (isPrivatePersonSession(id) && !ownsPersonSession(user.id, session)) failure('Session not found', 404)
    if ((session.profile || 'default') !== profile) failure('Session belongs to another Profile', 403)
    if (['workflow', 'group_chat'].includes(session.source)) failure('Stop orchestrated runs through their workflow or group chat', 409)
  } else {
    const ownerProfile = await findHermesSessionProfile(id)
    if (!ownerProfile) failure('Session not found', 404)
    if (ownerProfile !== profile) failure('Session belongs to another Profile', 403)
  }
  const server = getChatRunServer()
  if (!server) failure('Chat runtime is unavailable', 503)
  const stopped = server.isSessionRunning(id)
  if (stopped) {
    await server.abortSession(id, 'Stopped by user')
    return { ok: true, session_id: id, stopped: true }
  }
  // Not ours: a desktop/gateway run may own the session. Leave a cooperative
  // cancel request in the shared run registry — the owning side's sync loop
  // (desktop runtime once it joins) picks it up and stops the run itself.
  const entry = requestSessionRunCancel(id)
  return { ok: true, session_id: id, stopped: false, cancel_requested: !!entry, origin: entry?.origin ?? null }
}
