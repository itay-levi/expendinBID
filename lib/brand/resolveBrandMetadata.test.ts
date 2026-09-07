import { describe, expect, it } from 'vitest'
import { extractMeta } from './resolveBrandMetadata'

const BASE = 'https://example.com/page'

describe('extractMeta — normal pages', () => {
  it('prefers og:title over <title>', () => {
    const html = `<head><title>Fallback</title><meta property="og:title" content="Real Title"></head>`
    expect(extractMeta(html, BASE).title).toBe('Real Title')
  })

  it('falls back to <title> when og:title is absent', () => {
    expect(extractMeta('<head><title>Just A Title</title></head>', BASE).title).toBe('Just A Title')
  })

  it('prefers og:description over meta description', () => {
    const html = `<meta name="description" content="meta desc"><meta property="og:description" content="og desc">`
    expect(extractMeta(html, BASE).description).toBe('og desc')
  })

  it('resolves a relative og:image against the page URL', () => {
    const html = `<meta property="og:image" content="/img/logo.png">`
    expect(extractMeta(html, BASE).logoUrl).toBe('https://example.com/img/logo.png')
  })

  it('falls back to apple-touch-icon when there is no og:image', () => {
    const html = `<link rel="apple-touch-icon" href="/touch.png">`
    expect(extractMeta(html, BASE).logoUrl).toBe('https://example.com/touch.png')
  })

  it('returns null logo when the page advertises none', () => {
    expect(extractMeta('<head><title>x</title></head>', BASE).logoUrl).toBeNull()
  })

  it('decodes HTML entities into plain text', () => {
    const html = `<title>Ben &amp; Jerry&#39;s &quot;Best&quot;</title>`
    expect(extractMeta(html, BASE).title).toBe(`Ben & Jerry's "Best"`)
  })
})

describe('extractMeta — hostile / abusive input', () => {
  it('truncates an absurdly long title so it cannot bloat storage or the UI', () => {
    const html = `<title>${'A'.repeat(5000)}</title>`
    expect(extractMeta(html, BASE).title.length).toBeLessThanOrEqual(120)
  })

  it('truncates an absurdly long description', () => {
    const html = `<meta name="description" content="${'B'.repeat(5000)}">`
    expect(extractMeta(html, BASE).description.length).toBeLessThanOrEqual(240)
  })

  it('extracts injected markup as inert text rather than executing intent', () => {
    // The extracted value may legitimately contain angle brackets as TEXT. What matters is that
    // it comes back as a plain string for React to escape on render — never as markup we build
    // HTML from. This test pins the contract that callers receive a string, not HTML.
    const html = `<meta property="og:title" content="x&quot;&gt;&lt;img src=x onerror=alert(1)&gt;">`
    const { title } = extractMeta(html, BASE)
    expect(typeof title).toBe('string')
    expect(title).toContain('img src=x')
  })

  it('does not crash on malformed or empty HTML', () => {
    for (const html of ['', '<html', '<<<>>>', '<head><title></title></head>']) {
      expect(() => extractMeta(html, BASE)).not.toThrow()
    }
  })

  it('ignores metadata buried past the scanned head window', () => {
    const html = `${'<!-- padding -->'.repeat(9000)}<title>Way Too Late</title>`
    expect(extractMeta(html, BASE).title).toBe('')
  })

  it('does not throw when og:image is an unparseable URL', () => {
    const html = `<meta property="og:image" content="ht!tp://%%%">`
    expect(() => extractMeta(html, BASE)).not.toThrow()
  })
})
