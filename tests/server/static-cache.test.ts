import { describe, expect, it } from 'vitest'
import {
  getStaticCacheControl,
  IMMUTABLE_ASSET_CACHE_CONTROL,
  SPA_ENTRY_CACHE_CONTROL,
} from '../../packages/server/src/modules/studio/middleware/static-cache'

describe('static cache headers', () => {
  it('caches fingerprinted build assets as immutable', () => {
    expect(getStaticCacheControl('assets/js/index-abc123.js')).toBe(IMMUTABLE_ASSET_CACHE_CONTROL)
    expect(getStaticCacheControl('assets\\css\\index-abc123.css')).toBe(IMMUTABLE_ASSET_CACHE_CONTROL)
  })

  it('revalidates the SPA entry and leaves public assets unchanged', () => {
    expect(getStaticCacheControl('index.html')).toBe(SPA_ENTRY_CACHE_CONTROL)
    expect(getStaticCacheControl('random.bin')).toBeNull()
  })

  it('caches non-fingerprinted public assets with a bounded window', () => {
    expect(getStaticCacheControl('logo.png')).toBe('public, max-age=604800')
    expect(getStaticCacheControl('fonts/ZenMaruGothic-Regular.ttf')).toBe('public, max-age=604800')
    expect(getStaticCacheControl('coding-agents/claude-code.svg')).toBe('public, max-age=604800')
    expect(getStaticCacheControl('icons/ekko.svg')).toBe('public, max-age=604800')
  })

  it('always revalidates shell scripts via ETag 304s', () => {
    expect(getStaticCacheControl('boot.js')).toBe('no-cache')
    expect(getStaticCacheControl('sw.js')).toBe('no-cache')
    expect(getStaticCacheControl('manifest.webmanifest')).toBe('no-cache')
  })
})
