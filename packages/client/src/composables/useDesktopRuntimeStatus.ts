import { onBeforeUnmount, onMounted, ref } from 'vue'
import { request } from '@/api/client'
import { isDesktopShell } from '@/utils/desktop-bridge'

/**
 * Poll the anonymous /health endpoint and track whether the local desktop-side
 * Hermes runtime (agent bridge) is reachable. When the Mac app is shut down
 * the studio server keeps serving pages, but every chat run would hang —
 * surfaces "Mac 端未运行" instead of an endless spinner. Skipped inside the
 * desktop shell itself (bridge is local there by definition).
 */
export function useDesktopRuntimeStatus(intervalMs = 15_000) {
  const desktopOffline = ref(false)
  let timer: ReturnType<typeof setInterval> | null = null

  async function check() {
    try {
      const res = await request<{ agent_bridge?: { reachable?: boolean } }>('/health')
      desktopOffline.value = res?.agent_bridge?.reachable !== true
    } catch {
      // Server itself unreachable (tunnel down) — keep last known state;
      // the page-level connection errors cover that case.
    }
  }

  function start() {
    if (timer || isDesktopShell()) return
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

  return { desktopOffline }
}
