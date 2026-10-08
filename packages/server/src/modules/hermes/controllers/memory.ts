import { mkdir, writeFile, readdir } from 'fs/promises'
import { join } from 'path'
import { safeReadFile, safeStat } from '../../studio/public/files'
import { getActiveProfileName, getProfileDir } from '../services/profiles/profile'

const PROJECT_MEMORY_DIR = 'memories/projects'
// 项目记忆文件名形如 <sha1-8>-<name>.md / .md.lock；校验防路径穿越
const PROJECT_FILE_RE = /^[a-f0-9]{8}-[\w\-.]+\.md$/

function requestedProfile(ctx: any): string {
  return ctx.state?.profile?.name || getActiveProfileName() || 'default'
}

function requestProfileDir(ctx: any): string {
  return getProfileDir(requestedProfile(ctx))
}

function projectMemoryDir(ctx: any): string {
  return join(requestProfileDir(ctx), PROJECT_MEMORY_DIR)
}

function safeProjectFile(ctx: any, name: string): string | null {
  if (!PROJECT_FILE_RE.test(name)) return null
  return join(projectMemoryDir(ctx), name)
}

/** GET /api/hermes/memory/projects — 项目记忆文件列表（含诊断信息） */
export async function listProjects(ctx: any) {
  const dir = projectMemoryDir(ctx)
  let entries: string[] = []
  try {
    entries = await readdir(dir)
  } catch {
    ctx.body = { projects: [] }
    return
  }
  const projects = await Promise.all(
    entries
      .filter((f) => PROJECT_FILE_RE.test(f))
      .map(async (f) => {
        const p = join(dir, f)
        const [content, stat] = await Promise.all([safeReadFile(p), safeStat(p)])
        // 文件名 <hash>-<name>.md → 展示名去 hash 去 .md
        const displayName = f.replace(/\.md$/, '').replace(/^[a-f0-9]{8}-/, '')
        return {
          file: f,
          name: displayName,
          content: content || '',
          size: (content || '').length,
          mtime: stat?.mtime ?? null,
        }
      }),
  )
  projects.sort((a, b) => (b.mtime || 0) - (a.mtime || 0))
  ctx.body = { projects }
}

/** POST /api/hermes/memory/projects — { file, content } 保存项目记忆 */
export async function saveProject(ctx: any) {
  const { file, content } = ctx.request.body as { file?: string; content?: string }
  if (!file || content === undefined || content === null) {
    ctx.status = 400
    ctx.body = { error: 'Missing file or content' }
    return
  }
  const filePath = safeProjectFile(ctx, file)
  if (!filePath) {
    ctx.status = 400
    ctx.body = { error: 'Invalid project memory file name' }
    return
  }
  try {
    await mkdir(projectMemoryDir(ctx), { recursive: true })
    await writeFile(filePath, content, 'utf-8')
    ctx.body = { success: true }
  } catch (err: any) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
}

export async function get(ctx: any) {
  const hd = requestProfileDir(ctx)
  const memoryPath = join(hd, 'memories', 'MEMORY.md')
  const userPath = join(hd, 'memories', 'USER.md')
  const soulPath = join(hd, 'SOUL.md')
  const [memory, user, soul, memoryStat, userStat, soulStat] = await Promise.all([
    safeReadFile(memoryPath), safeReadFile(userPath), safeReadFile(soulPath),
    safeStat(memoryPath), safeStat(userPath), safeStat(soulPath),
  ])
  ctx.body = {
    memory: memory || '', user: user || '', soul: soul || '',
    memory_mtime: memoryStat?.mtime || null, user_mtime: userStat?.mtime || null, soul_mtime: soulStat?.mtime || null,
  }
}

export async function save(ctx: any) {
  const { section, content } = ctx.request.body as { section: string; content: string }
  if (!section || content === undefined || content === null) {
    ctx.status = 400
    ctx.body = { error: 'Missing section or content' }
    return
  }
  if (section !== 'memory' && section !== 'user' && section !== 'soul') {
    ctx.status = 400
    ctx.body = { error: 'Section must be "memory", "user", or "soul"' }
    return
  }
  let filePath: string
  const hd = requestProfileDir(ctx)
  if (section === 'soul') {
    filePath = join(hd, 'SOUL.md')
  } else {
    const fileName = section === 'memory' ? 'MEMORY.md' : 'USER.md'
    await mkdir(join(hd, 'memories'), { recursive: true })
    filePath = join(hd, 'memories', fileName)
  }
  try {
    await writeFile(filePath, content, 'utf-8')
    ctx.body = { success: true }
  } catch (err: any) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
}
