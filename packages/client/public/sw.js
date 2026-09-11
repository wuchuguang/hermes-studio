// Ekko/Hermes Studio — offline shell service worker (2026-09-11 v1)
// 目标: 杀掉 PWA 后重开, 壳资源(入口/字体/图标)从 SW 缓存秒出, 不再等隧道 RTT。
// 策略:
//  - install: 立即接管(skipWaiting) + 后台预热缓存, 不阻塞安装
//  - index.html / boot.js / manifest: network-first (有更新立即生效), 失败回缓存
//  - assets/* (带 hash): cache-first (immutable, 永不重验)
//  - fonts|coding-agents|icons|logo.png: stale-while-revalidate (7天, 后台刷新)
//  - 其余非 /api 导航: 放行网络 (WebSocket/SSE 不经过 fetch handler)
const VERSION = 'ekko-shell-v2'
const SHELL_CACHE = VERSION + '-shell'
const STATIC_CACHE = VERSION + '-static'
// Startup reads served stale-while-revalidate so cold PWA launches paint
// instantly from cache and refresh in the background. Keyed per auth token
// (hash prefix) so multi-account caches never mix.
const API_CACHE = VERSION + '-api'
const API_SWR_PATHS = [
  '/api/studio/theme',
  '/api/studio/tts/settings',
  '/api/studio/session-categories',
  '/api/studio/pets/active',
  '/api/auth/me',
  '/api/hermes/profiles',
  '/api/hermes/config',
  '/api/hermes/available-models',
]

async function apiStaleWhileRevalidate(request) {
  const auth = request.headers.get('authorization') || ''
  const profile = request.headers.get('x-hermes-profile') || ''
  // tiny hash to keep cache keys bounded and avoid storing raw tokens
  const scope = (auth + '|' + profile).length + ':' + (auth + '|' + profile).slice(-8)
  const cache = await caches.open(API_CACHE)
  const key = new Request(request.url + (request.url.includes('?') ? '&' : '?') + '__swr=' + encodeURIComponent(scope))
  const cached = await cache.match(key)
  const refresh = fetch(request).then((fresh) => {
    if (fresh && fresh.ok) cache.put(key, fresh.clone())
    return fresh
  }).catch(() => null)
  if (cached) return cached
  const fresh = await refresh
  if (fresh) return fresh
  throw new Error('offline and not cached: ' + request.url)
}

const SHELL_URLS = [
  '/',
  '/boot.js',
  '/manifest.webmanifest',
  '/logo.png',
  '/favicon.ico',
]

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => Promise.allSettled(SHELL_URLS.map((u) => cache.add(u))))
      .catch(() => {}),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.disable() } catch {}
    }
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== STATIC_CACHE).map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  try {
    const fresh = await fetch(request)
    if (fresh && fresh.ok) cache.put(request, fresh.clone())
    return fresh
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true })
    if (cached) return cached
    throw new Error('offline and not cached: ' + request.url)
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached
  const fresh = await fetch(request)
  if (fresh && fresh.ok) cache.put(request, fresh.clone())
  return fresh
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  const refresh = fetch(request)
    .then((fresh) => {
      if (fresh && fresh.ok) cache.put(request, fresh.clone())
      return fresh
    })
    .catch(() => null)
  return cached || refresh.then((r) => {
    if (r) return r
    throw new Error('offline and not cached: ' + request.url)
  })
}

// 通知点击 (原 notification-sw.js 职责, 合并避免同 scope 抢注册)
function safeClickUrl(value) {
  return typeof value === 'string'
    && value.startsWith('/hermes/')
    && !value.includes('..')
    && !value.includes('\\')
    ? value
    : null
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil((async () => {
    const clickUrl = safeClickUrl(event.notification.data?.clickUrl)
    const target = clickUrl ? `/#${clickUrl}` : '/'
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if (clickUrl && 'navigate' in client) await client.navigate(target)
      if ('focus' in client) return client.focus()
    }
    if (clients.openWindow) return clients.openWindow(target)
  })())
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) {
    const bare = url.pathname
    if (API_SWR_PATHS.some((p) => bare === p || bare.startsWith(p + '/'))) {
      event.respondWith(apiStaleWhileRevalidate(request))
    }
    return
  }

  // SPA 导航请求: 缓存壳秒出 + 后台刷新 (隧道 RTT 是启动瓶颈, 不让用户等)
  // 首次无缓存时走网络; index.html 只有 4KB, 引用的 hash 资产 cacheFirst 兜底
  if (request.mode === 'navigate') {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE))
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE))
    return
  }

  if (/^\/(fonts|coding-agents|icons)\//.test(url.pathname) || url.pathname === '/logo.png') {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE))
    return
  }

  if (url.pathname === '/boot.js' || url.pathname === '/manifest.webmanifest') {
    event.respondWith(networkFirst(request, SHELL_CACHE))
  }
})
