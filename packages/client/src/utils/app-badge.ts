/**
 * PWA app-badge helper. iOS 16.4+ standalone (and some Android PWAs) expose
 * navigator.setAppBadge/clearAppBadge; everywhere else this is a no-op.
 * Used to mark "a turn finished / needs attention" while the app is
 * backgrounded or on another session's page.
 */
export function setAppBadgeSafely(count = 1): void {
  try {
    const nav = navigator as Navigator & {
      setAppBadge?: (count?: number) => Promise<void>
    }
    void nav.setAppBadge?.(count)?.catch(() => undefined)
  } catch {
    /* unsupported — silent */
  }
}

export function clearAppBadgeSafely(): void {
  try {
    const nav = navigator as Navigator & {
      clearAppBadge?: () => Promise<void>
    }
    void nav.clearAppBadge?.()?.catch(() => undefined)
  } catch {
    /* unsupported — silent */
  }
}
