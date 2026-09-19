import { onBeforeUnmount, onMounted, ref } from 'vue'
import { request } from '@/api/client'

/**
 * Poll the server's client shell build id and flag when a newer build is
 * live. The SW serves hashed assets cache-first, so a stale PWA shell
 * keeps running an old bundle until reloaded — this surfaces a
 * "tap to refresh" hint instead of a silent stale app. Desktop (localhost
 * dev/server) polls too; reload is cheap there.
 */
export function useClientBuildRefresh(intervalMs = 120_000) {
  const newBuildAvailable = ref(false)
  let timer: ReturnType<typeof setInterval> | null = null
  let currentId: string | null = null

  async function check() {
    try {
      const res = await request<{ buildId?: string }>('/client-build-id')
      const id = res?.buildId
      if (!id || id === 'unknown') return
      if (currentId === null) {
        currentId = id
        return
      }
      if (id !== currentId) {
        currentId = id
        newBuildAvailable.value = true
        stop()
      }
    } catch {
      // Network hiccup or logged-out — ignore; next tick retries.
    }
  }

  function start() {
    if (timer) return
    void check()
    timer = setInterval(() => void check(), intervalMs)
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  onMounted(start)
  onBeforeUnmount(stop)

  function reload() {
    location.reload()
  }

  return { newBuildAvailable, reload }
}
