import { openCodeSessionHeaders } from './opencode-session'
import { logger } from './logging'
import { OPENCODE_FREE_BASE_URL, isOpenCodeFreeModel } from '../contracts/opencode-free'

export async function fetchOpenCodeFreeModels(): Promise<string[]> {
  return (await fetchProviderModels(OPENCODE_FREE_BASE_URL, '')).filter(isOpenCodeFreeModel)
}

export async function fetchProviderModels(baseUrl: string, apiKey: string, freeOnly = false): Promise<string[]> {
  const base = baseUrl.replace(/\/+$/, '')
  const modelsUrl = /\/v\d+\/?$/.test(base) ? `${base}/models` : `${base}/v1/models`
  try {
    const response = await fetch(modelsUrl, {
      headers: { ...openCodeSessionHeaders(modelsUrl), ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) {
      logger.warn('available-models %s returned %d', modelsUrl, response.status)
      return []
    }
    const data = await response.json() as { data?: Array<{ id: string }>; models?: Array<{ id?: string; slug?: string; name?: string }> }
    // 兼容 OpenAI { data: [...] } 与 Codex 目录 { models: [...] } 两种格式
    const rawList = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.models) ? data.models : null)
    if (!rawList) {
      logger.warn('available-models %s returned unexpected format', modelsUrl)
      return []
    }
    let models = rawList.map(model => (model as { id?: string; slug?: string; name?: string }).id || (model as { slug?: string }).slug || (model as { name?: string }).name || '')
    if (base.includes('generativelanguage.googleapis.com')) {
      models = models.map(model => model.startsWith('models/') ? model.slice('models/'.length) : model)
    }
    if (freeOnly) models = models.filter(model => model.endsWith(':free'))
    return models.sort()
  } catch (error: any) {
    logger.error(error, 'available-models %s failed', modelsUrl)
    return []
  }
}
