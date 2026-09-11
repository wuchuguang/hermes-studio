export const IMMUTABLE_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable'
export const SPA_ENTRY_CACHE_CONTROL = 'no-cache'
// Non-fingerprinted public assets (fonts, icons, logos). Content changes only
// across releases, so a bounded revalidation window + conditional GET keeps
// cold PWA launches from re-downloading multi-MB files while staying fresh.
export const PUBLIC_ASSET_CACHE_CONTROL = 'public, max-age=604800'
// Shell scripts the browser/SW must always revalidate (cheap 304 via ETag).
export const SHELL_REVALIDATE_CACHE_CONTROL = 'no-cache'

const PUBLIC_ASSET_PREFIXES = ['fonts/', 'coding-agents/', 'icons/']
const PUBLIC_ASSET_FILES = new Set([
  'logo.png',
  'logo-original.png',
  'favicon.ico',
])
const SHELL_REVALIDATE_FILES = new Set(['boot.js', 'manifest.webmanifest', 'sw.js'])

export function getStaticCacheControl(relativePath: string): string | null {
  const normalizedPath = relativePath.replaceAll('\\', '/').replace(/^\.\//, '')
  if (normalizedPath === 'index.html') return SPA_ENTRY_CACHE_CONTROL
  if (normalizedPath.startsWith('assets/')) return IMMUTABLE_ASSET_CACHE_CONTROL
  if (SHELL_REVALIDATE_FILES.has(normalizedPath)) return SHELL_REVALIDATE_CACHE_CONTROL
  if (PUBLIC_ASSET_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix))) {
    return PUBLIC_ASSET_CACHE_CONTROL
  }
  if (PUBLIC_ASSET_FILES.has(normalizedPath)) return PUBLIC_ASSET_CACHE_CONTROL
  return null
}
